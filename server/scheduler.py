# server/scheduler.py
from __future__ import annotations

import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from apscheduler.schedulers.background import BackgroundScheduler

# ====== CONFIG ======
TICK_SECONDS = 10  # frecuencia del ciclo (segundos)
LOCAL_TZ = ZoneInfo(os.getenv("LOCAL_TZ", "Europe/Madrid"))

# ====== HELPERS TIEMPO ======
def _now_utc() -> datetime:
    return datetime.now(ZoneInfo("UTC"))

def _parse_time(s: str | None) -> tuple[int, int, int] | None:
    """
    Acepta "HH:MM", "HH:MM:SS" y "HH:MM:SS.ssssss"
    Devuelve (hh, mm, ss)
    """
    if not s:
        return None
    try:
        p = s.split(":")
        hh = int(p[0])
        mm = int(p[1])
        ss = 0
        if len(p) >= 3:
            ss = int(float(p[2]))  # elimina microsegundos si llegan
        return hh, mm, ss
    except Exception:
        return None

def _local_to_utc(dt_local: datetime) -> datetime:
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(ZoneInfo("UTC"))

def _utc_to_local(dt_utc: datetime) -> datetime:
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=ZoneInfo("UTC"))
    return dt_utc.astimezone(LOCAL_TZ)


def create_scheduler(app):
    """
    Arranca un BackgroundScheduler y programa el chequeo periódico.
    """
    SUPABASE_URL = (app.config.get("SUPABASE_URL") or os.getenv("SUPABASE_URL", "")).rstrip("/")
    SB_ANON = app.config.get("SUPABASE_API_KEY") or os.getenv("SUPABASE_API_KEY", "")
    SB_SR   = app.config.get("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    # ====== Tablas / columnas ======
    # Citas
    APPT_TABLE, APPT_USER_COL, APPT_DATE_COL, APPT_START_COL = (
        "appointments", "owner_id", "date", "start_time"
    )
    # Tareas (dueño = 'usuario')
    TASK_TABLE, TASK_USER_COL, TASK_DONE_COL, TASK_DATE_COL, TASK_START_COL = (
        "tasks", "usuario", "is_completed", "due_date", "start_time"
    )
    # Rutinas (dueño = 'usuario')
    ROUT_TABLE, ROUT_USER_COL, ROUT_START_COL, ROUT_DOW_COL, ROUT_ACTIVE_COL, ROUT_END_DATE_COL = (
        "routines", "usuario", "start_time", "days_of_week", "is_active", "end_date"
    )

    PREFS_TABLE = "notification_prefs"   # user_id uuid, tasks_lead_min int4, citas_leads_min int4[]
    SENT_TABLE  = "notifications_sent"   # user_id uuid, entity_type text, entity_id uuid/text, kind text, sent_at timestamptz

    def _supa_headers(service: bool = False):
        key = SB_SR if service else SB_ANON
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
        }

    # ====== DEDUP ======
    def _already_sent(user_id: str, entity_type: str, entity_id: str | None) -> bool:
        try:
            params = [
                ("select", "id"),
                ("user_id", f"eq.{user_id}"),
                ("entity_type", f"eq.{entity_type}"),
                ("limit", "1"),
            ]
            if entity_id:
                params.append(("entity_id", f"eq.{entity_id}"))
            url = f"{SUPABASE_URL}/rest/v1/{SENT_TABLE}"
            r = requests.get(url, headers=_supa_headers(True), params=params, timeout=10)
            if r.ok:
                return bool(r.json())
        except Exception:
            pass
        return False

    def _mark_sent(user_id: str, entity_type: str, entity_id: str | None, kind: str):
        try:
            url = f"{SUPABASE_URL}/rest/v1/{SENT_TABLE}"
            payload = {"user_id": user_id, "entity_type": entity_type, "kind": kind}
            if entity_id:
                payload["entity_id"] = str(entity_id)
            requests.post(url, headers=_supa_headers(True), json=payload, timeout=10)
        except Exception as e:
            app.logger.warning("[sched] mark_sent error: %s", e)

    # ====== PUSH ======
    def _send_push(user_id: str, title: str, body: str, url_path: str = "/"):
        base = os.getenv("PUSH_BASE_URL", "http://127.0.0.1:5000").rstrip("/")
        try:
            r = requests.post(
                f"{base}/api/push/send",
                headers={"Content-Type": "application/json"},
                json={"user_id": user_id, "title": title, "body": body, "url": url_path},
                timeout=10,
            )
            app.logger.info("[push] send -> %s %s", r.status_code, r.text[:120])
        except Exception as e:
            app.logger.warning("[push] send exception: %s", e)

    # ====== CHEQUEOS ======
    def _check_tasks(user_id: str, lead_min: int | None):
        """
        Dispara cuando (due_date + start_time) + lead_min cae en [now - TICK, now].
        Ignora tareas completadas.
        """
        if lead_min is None:
            return

        base = f"{SUPABASE_URL}/rest/v1/{TASK_TABLE}"
        now_utc = _now_utc()
        win_start, win_end = now_utc - timedelta(seconds=TICK_SECONDS), now_utc

        now_local = _utc_to_local(now_utc)
        day_min = (now_local - timedelta(days=1)).date().isoformat()
        day_max = (now_local + timedelta(days=1)).date().isoformat()

        params = [
            ("select", f"id,{TASK_USER_COL},{TASK_DATE_COL},{TASK_START_COL},{TASK_DONE_COL},description"),
            (TASK_USER_COL, f"eq.{user_id}"),
            (TASK_DONE_COL, "is.false"),
            (TASK_DATE_COL, f"gte.{day_min}"),
            (TASK_DATE_COL, f"lte.{day_max}"),
            ("limit", "200"),
        ]
        try:
            r = requests.get(base, headers=_supa_headers(True), params=params, timeout=10)
            app.logger.info("[sched] uid=%s tasks off=%s status=%s", user_id, lead_min, r.status_code)
            if not r.ok:
                app.logger.warning("[sched] tasks body=%s", r.text[:200])
                return

            for row in (r.json() or []):
                d = row.get(TASK_DATE_COL)
                t = row.get(TASK_START_COL)
                tm = _parse_time(t) if (d and t) else None
                if not tm:
                    continue
                yy, mm, dd = map(int, d.split("-"))
                hh, mi, ss = tm
                event_utc = _local_to_utc(datetime(yy, mm, dd, hh, mi, ss))
                target = event_utc + timedelta(minutes=lead_min)
                if win_start <= target <= win_end:
                    item_id = row.get("id")
                    if not _already_sent(user_id, "task", item_id):
                        title = row.get("description") or "Tarea"
                        _send_push(user_id, f"✅ {title}", "Recordatorio de tarea", "/")
                        _mark_sent(user_id, "task", item_id, "task")
        except Exception as e:
            app.logger.warning("[sched] tasks exception: %s", e)

    def _check_routines(user_id: str, offsets: list[int]):
        """
        Rutinas activas: dispara cuando (hoy a start_time) + offset cae en [now - TICK, now].
        """
        if not offsets:
            return

        base = f"{SUPABASE_URL}/rest/v1/{ROUT_TABLE}"
        now_utc = _now_utc()
        win_start, win_end = now_utc - timedelta(seconds=TICK_SECONDS), now_utc

        now_local = _utc_to_local(now_utc)
        today = now_local.date().isoformat()

        params = [
            ("select", f"id,{ROUT_USER_COL},{ROUT_START_COL},{ROUT_ACTIVE_COL},description,{ROUT_END_DATE_COL}"),
            (ROUT_USER_COL, f"eq.{user_id}"),
            (ROUT_ACTIVE_COL, "is.true"),
            ("limit", "200"),
        ]
        try:
            r = requests.get(base, headers=_supa_headers(True), params=params, timeout=10)
            app.logger.info("[sched] uid=%s routines off=%s status=%s", user_id, offsets, r.status_code)
            if not r.ok:
                app.logger.warning("[sched] routines body=%s", r.text[:200])
                return

            for row in (r.json() or []):
                end_d = row.get(ROUT_END_DATE_COL)
                if end_d:
                    try:
                        if datetime.fromisoformat(end_d).date() < datetime.now(LOCAL_TZ).date():
                            continue
                    except Exception:
                        pass

                t = row.get(ROUT_START_COL)
                tm = _parse_time(t)
                if not tm:
                    continue
                yy, mm, dd = map(int, today.split("-"))
                hh, mi, ss = tm
                event_utc = _local_to_utc(datetime(yy, mm, dd, hh, mi, ss))

                for off in offsets:
                    target = event_utc + timedelta(minutes=off)
                    if win_start <= target <= win_end:
                        item_id = row.get("id")
                        if not _already_sent(user_id, "routine", item_id):
                            title = row.get("description") or "Rutina"
                            _send_push(user_id, f"🔁 {title}", "Recordatorio de rutina", "/")
                            _mark_sent(user_id, "routine", item_id, "routine")
                        break
        except Exception as e:
            app.logger.warning("[sched] routines exception: %s", e)

    def _check_appointments(user_id: str, offsets: list[int]):
        """
        Citas: dispara cuando (date + start_time) + offset cae en [now - TICK, now].
        """
        if not offsets:
            return

        base = f"{SUPABASE_URL}/rest/v1/{APPT_TABLE}"
        now_utc = _now_utc()
        win_start, win_end = now_utc - timedelta(seconds=TICK_SECONDS), now_utc

        now_local = _utc_to_local(now_utc)
        day_min = (now_local - timedelta(days=1)).date().isoformat()
        day_max = (now_local + timedelta(days=1)).date().isoformat()

        params = [
            ("select", f"id,{APPT_USER_COL},{APPT_DATE_COL},{APPT_START_COL},description"),
            (APPT_USER_COL, f"eq.{user_id}"),
            (APPT_DATE_COL, f"gte.{day_min}"),
            (APPT_DATE_COL, f"lte.{day_max}"),
            ("limit", "200"),
        ]
        try:
            r = requests.get(base, headers=_supa_headers(True), params=params, timeout=10)
            app.logger.info("[sched] uid=%s appointments %s..%s status=%s", user_id, day_min, day_max, r.status_code)
            if not r.ok:
                app.logger.warning("[sched] appts body=%s", r.text[:200])
                return

            for row in (r.json() or []):
                d = row.get(APPT_DATE_COL)
                t = row.get(APPT_START_COL)
                tm = _parse_time(t) if (d and t) else None
                if not tm:
                    continue
                yy, mm, dd = map(int, d.split("-"))
                hh, mi, ss = tm
                event_utc = _local_to_utc(datetime(yy, mm, dd, hh, mi, ss))

                for off in offsets:
                    target = event_utc + timedelta(minutes=off)
                    if win_start <= target <= win_end:
                        item_id = row.get("id")
                        if not _already_sent(user_id, "appointment", item_id):
                            title = row.get("description") or "Cita"
                            _send_push(user_id, f"⏰ {title}", "Recordatorio de cita", "/")
                            _mark_sent(user_id, "appointment", item_id, "appointment")
                        break
        except Exception as e:
            app.logger.warning("[sched] appts exception: %s", e)

    # ====== JOB PRINCIPAL ======
    def check_and_send():
        try:
            url = f"{SUPABASE_URL}/rest/v1/{PREFS_TABLE}"
            r = requests.get(
                url,
                headers=_supa_headers(True),
                params={"select": "user_id,tasks_lead_min,citas_leads_min", "limit": "200"},
                timeout=10,
            )
            if not r.ok:
                app.logger.warning("[sched] prefs body=%s", r.text[:200])
                return

            for pref in (r.json() or []):
                uid = pref.get("user_id")
                if not uid:
                    continue
                tasks_lead = pref.get("tasks_lead_min")            # int o None
                citas_offsets = pref.get("citas_leads_min") or []  # lista de enteros

                _check_appointments(uid, citas_offsets)
                _check_tasks(uid, tasks_lead)
                _check_routines(uid, citas_offsets)

        except Exception as e:
            app.logger.warning("[sched] main exception: %s", e)

    def _heartbeat():
        app.logger.info("🫀 vivo")

    # ====== ARRANQUE ======
    scheduler = BackgroundScheduler(timezone=str(ZoneInfo("UTC")))
    scheduler.add_job(check_and_send, "interval", seconds=TICK_SECONDS, id="check_and_send")
    scheduler.add_job(_heartbeat, "interval", minutes=1, id="heartbeat")
    scheduler.start()
    app.logger.info("scheduler started (tick=%ss)", TICK_SECONDS)

    return scheduler
