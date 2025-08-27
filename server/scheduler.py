# server/scheduler.py
import os
import json
import logging
import requests
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.date import DateTrigger
from pytz import utc  # APScheduler usa pytz para timezone

def create_scheduler(app):
    """
    Crea y configura el BackgroundScheduler con los mismos jobs que antes.
    Devuelve el scheduler (ya arrancado si ENABLE_SCHEDULER=true).
    """

    # === Config leída desde app.config y ENV ===
    SUPABASE_URL = (app.config.get("SUPABASE_URL") or "").rstrip("/")
    SUPABASE_API_KEY = app.config.get("SUPABASE_API_KEY")
    SUPABASE_SVC_KEY = app.config.get("SUPABASE_SERVICE_KEY") or SUPABASE_API_KEY

    VAPID_PUBLIC  = app.config.get("VAPID_PUBLIC")
    VAPID_PRIVATE = app.config.get("VAPID_PRIVATE")
    VAPID_CLAIMS  = app.config.get("VAPID_CLAIMS") or {}

    LOCAL_TZ  = ZoneInfo(os.getenv("LOCAL_TZ", "Europe/Madrid"))
    TICK_SECONDS = int(os.getenv("SCHED_TICK_SECONDS", "10"))

    # Tablas/columnas (igual que antes)
    APPT_TABLE, APPT_USER_COL, APPT_DATE_COL, APPT_START_COL = "appointments", "usuario", "date", "start_time"
    TASK_TABLE, TASK_USER_COL, TASK_DONE_COL, TASK_DATE_COL, TASK_START_COL = "tasks", "usuario", "is_completed", "due_date", "start_time"
    ROUT_TABLE, ROUT_USER_COL, ROUT_START_COL, ROUT_DOW_COL, ROUT_ACTIVE_COL, ROUT_END_DATE_COL = (
        "routines", "usuario", "start_time", "days_of_week", "is_active", "end_date"
    )
    PREFS_TABLE, SENT_TABLE = "notification_prefs", "notifications_sent"
    SPANISH_DOW = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"]

    # === Helpers internos (copiados del app.py) ===
    def _today_name_es() -> str:
        return SPANISH_DOW[datetime.now(LOCAL_TZ).weekday()]

    def _supa_headers(admin: bool = False) -> dict:
        key = SUPABASE_SVC_KEY if admin else SUPABASE_API_KEY
        return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _parse_hhmm(s: str):
        try:
            hh, mm = map(int, s.strip()[:5].split(":"))
            return hh, mm
        except Exception:
            return None

    def _local_to_utc(dt_local: datetime) -> datetime:
        if dt_local.tzinfo is None:
            dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
        return dt_local.astimezone(timezone.utc)

    def _iso_utc(dt: datetime) -> str:
        return dt.replace(microsecond=0).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    def _now_utc() -> datetime:
        return datetime.now(timezone.utc)

    def _distinct_usernames_with_subs() -> list[str]:
        url = f"{SUPABASE_URL}/rest/v1/push_subscriptions"
        r = requests.get(url, headers=_supa_headers(), params={"select": "username"}, timeout=10)
        r.raise_for_status()
        rows = r.json() or []
        return sorted({row.get("username") for row in rows if row.get("username")})

    def _get_prefs(username: str) -> dict:
        url = f"{SUPABASE_URL}/rest/v1/{PREFS_TABLE}"
        params = {"select": "username,tasks_lead_min,citas_leads_min", "username": f"eq.{username}", "limit": "1"}
        try:
            r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
            row = (r.json() or [{}])[0] if r.ok else {}
        except Exception:
            row = {}
        tasks_min_default = -15
        apt_default = [-43200, -21600, -1440, -60]
        try:
            tasks_min = -abs(int(row.get("tasks_lead_min", tasks_min_default)))
        except Exception:
            tasks_min = tasks_min_default
        try:
            apt = [(-abs(int(x))) for x in (row.get("citas_leads_min") or apt_default)]
            if not apt:
                apt = apt_default
        except Exception:
            apt = apt_default
        return {"tasks_lead_min": tasks_min, "citas_leads_min": apt}

    def _already_sent(username, kind, item_id, offset_min) -> bool:
        url = f"{SUPABASE_URL}/rest/v1/{SENT_TABLE}"
        and_param = f"(username.eq.{username},kind.eq.{kind},offset_min.eq.{int(offset_min)})"
        if item_id:
            and_param = f"(username.eq.{username},kind.eq.{kind},item_id.eq.{item_id},offset_min.eq.{int(offset_min)})"
        try:
            r = requests.get(url, headers=_supa_headers(True),
                             params={"select": "id", "and": and_param, "limit": 1}, timeout=10)
            return bool(r.ok and r.json())
        except Exception:
            return False

    def _mark_sent(username, kind, item_id, offset_min):
        url = f"{SUPABASE_URL}/rest/v1/{SENT_TABLE}"
        payload = {"username": username, "kind": kind, "item_id": item_id, "offset_min": int(offset_min), "fired_at": _iso_utc(_now_utc())}
        try:
            requests.post(url, headers=_supa_headers(True), json=payload, timeout=10)
        except Exception:
            pass

    def _send_push(username: str, title: str, body: str, url: str = "/"):
        try:
            base_env = (os.getenv("PUSH_BASE_URL") or "").strip().rstrip("/")
            base = base_env or "http://127.0.0.1:8000"
            endpoint = f"{base}/api/push/send"
            payload = {"username": username, "title": title, "body": body, "url": url}
            r = requests.post(endpoint, json=payload, timeout=10)
            if not r.ok:
                app.logger.warning("[push] POST %s -> %s %s", endpoint, r.status_code, r.text[:200])
                return False
            app.logger.info("[push] ✅ enviada a %s (%s)", username, endpoint)
            return True
        except Exception as e:
            app.logger.exception("[push] 💥 error enviando push: %s", e)
            return False

    # === Jobs (idénticos a los que tenías) ===
    def _check_tasks(username: str, tasks_offset_min: int):
        base = f"{SUPABASE_URL}/rest/v1/{TASK_TABLE}"
        now_utc   = _now_utc()
        win_start = now_utc - timedelta(seconds=TICK_SECONDS)
        win_end   = now_utc
        today_local = datetime.now(LOCAL_TZ).date().isoformat()
        select_cols = f"id,description,{TASK_DATE_COL},{TASK_START_COL},{TASK_DONE_COL},{TASK_USER_COL}"
        params = [
            ("select", select_cols),
            (TASK_USER_COL, f"eq.{username}"),
            (TASK_DONE_COL, "eq.false"),
            (TASK_DATE_COL, f"eq.{today_local}"),
            ("order", f"{TASK_DATE_COL}.asc,{TASK_START_COL}.asc"),
            ("limit", "100"),
        ]
        try:
            r = requests.get(base, headers=_supa_headers(True), params=params, timeout=10)
            app.logger.info("[sched] %s tasks off=%s status=%s", username, tasks_offset_min, r.status_code)
            if not r.ok:
                app.logger.warning("[sched] tasks body=%s", r.text[:200]); return
            for row in (r.json() or []):
                d = row.get(TASK_DATE_COL)
                hhmm = (row.get(TASK_START_COL) or "").strip()
                if not d or not hhmm: continue
                try:
                    yy, mm, dd = map(int, d.split("-"))
                    hh, mi = map(int, hhmm[:5].split(":"))
                except Exception:
                    continue
                start_utc = _local_to_utc(datetime(yy, mm, dd, hh, mi))
                target = start_utc + timedelta(minutes=tasks_offset_min)
                if win_start <= target <= win_end:
                    desc = row.get("description") or "Tarea"
                    _send_push(username, "Tarea", f"{desc} • empieza ya", url="/app")
                    app.logger.info("[sched] TASK HIT id=%s desc=%s at=%s", row.get("id"), desc, target)
        except Exception as e:
            app.logger.warning("[sched] tasks exception: %s", e)

    def _check_routines(username: str, offset_min: int):
        base = f"{SUPABASE_URL}/rest/v1/{ROUT_TABLE}"
        now_utc   = _now_utc()
        win_start = now_utc - timedelta(seconds=TICK_SECONDS)
        win_end   = now_utc
        today_local = datetime.now(LOCAL_TZ).date()
        today_name  = _today_name_es()
        select_cols = f"id,description,{ROUT_START_COL},{ROUT_USER_COL},{ROUT_DOW_COL},{ROUT_ACTIVE_COL},{ROUT_END_DATE_COL}"
        params = [
            ("select", select_cols),
            (ROUT_USER_COL, f"eq.{username}"),
            (ROUT_ACTIVE_COL, "eq.true"),
            (ROUT_DOW_COL, "cs." + json.dumps([today_name])),
            ("limit", "100"),
        ]
        try:
            r = requests.get(base, headers=_supa_headers(True), params=params, timeout=10)
            app.logger.info("[sched] %s routines off=%s status=%s", username, offset_min, r.status_code)
            if not r.ok:
                app.logger.warning("[sched] routines body=%s", r.text[:200]); return
            for row in (r.json() or []):
                st = (row.get(ROUT_START_COL) or "").strip()
                if len(st) < 4: continue
                hh, mi = map(int, st[:5].split(":"))
                start_utc = _local_to_utc(datetime(today_local.year, today_local.month, today_local.day, hh, mi))
                target = start_utc + timedelta(minutes=offset_min)
                if win_start <= target <= win_end:
                    desc = row.get("description") or "Rutina"
                    if not _already_sent(username, "routine", row.get("id"), offset_min):
                        _send_push(username, "Rutina", f"{desc} • empieza ya", url="/app")
                        _mark_sent(username, "routine", row.get("id"), offset_min)
        except Exception as e:
            app.logger.warning("[sched] routines exception: %s", e)

    def _check_appointments(username: str, offsets: list[int]):
        if not offsets: return
        base    = f"{SUPABASE_URL}/rest/v1/{APPT_TABLE}"
        now_utc = _now_utc()
        win_end = now_utc + timedelta(seconds=TICK_SECONDS)
        now_local = datetime.now(LOCAL_TZ)
        day_min = (now_local - timedelta(days=1)).date().isoformat()
        day_max = (now_local + timedelta(days=1)).date().isoformat()
        for off in offsets:
            start_from_utc = now_utc - timedelta(minutes=off)
            start_to_utc   = win_end  - timedelta(minutes=off)
            params = [
                ("select", f"id,{APPT_USER_COL},{APPT_DATE_COL},{APPT_START_COL},description"),
                (APPT_USER_COL, f"eq.{username}"),
                (APPT_DATE_COL, f"gte.{day_min}"),
                (APPT_DATE_COL, f"lte.{day_max}"),
            ]
            try:
                r = requests.get(base, headers=_supa_headers(True), params=params, timeout=10)
                app.logger.info("[sched] %s appointments off=%s %s..%s status=%s", username, off, day_min, day_max, r.status_code)
                if not r.ok:
                    app.logger.warning("[sched] appts body=%s", r.text[:200]); continue
                for row in (r.json() or []):
                    d = row.get(APPT_DATE_COL); t = row.get(APPT_START_COL)
                    hhmm = _parse_hhmm(t) if (d and t) else None
                    if not hhmm: continue
                    yy, mm, dd = map(int, d.split("-")); hh, mi = hhmm
                    event_utc = _local_to_utc(datetime(yy, mm, dd, hh, mi))
                    if start_from_utc <= event_utc < start_to_utc:
                        item_id = row.get("id")
                        if not _already_sent(username, "appointment", item_id, off):
                            title = row.get("description") or "Cita"
                            _send_push(username, f"⏰ {title}", "Recordatorio de cita", "/")
                            _mark_sent(username, "appointment", item_id, off)
            except Exception as e:
                app.logger.warning("[sched] appts exception: %s", e)

    # === Job principal y scheduler ===
    def check_and_send():
        with app.app_context():
            try:
                users = _distinct_usernames_with_subs()
                for u in users:
                    prefs = _get_prefs(u)
                    _check_appointments(u, prefs["citas_leads_min"])
                    _check_tasks(u, prefs["tasks_lead_min"])
                    _check_routines(u, prefs["tasks_lead_min"])
            except Exception as e:
                app.logger.exception("scheduler error: %s", e)

    scheduler = BackgroundScheduler(timezone=utc, daemon=True)

    scheduler.add_job(
        check_and_send, "interval", seconds=TICK_SECONDS,
        id="push-tick", misfire_grace_time=300, replace_existing=True
    )

    def _heartbeat():
        app.logger.info("[sched] ⏱️ vivo")

    scheduler.add_job(
        _heartbeat, IntervalTrigger(seconds=60),
        id="heartbeat", replace_existing=True, misfire_grace_time=120
    )

    def _boot_kick():
        app.logger.info("[sched] 🚀 boot-kick: ejecutar check_and_send una vez")
        try:
            check_and_send()
            app.logger.info("[sched] ✅ boot-kick OK")
        except Exception as e:
            app.logger.exception("[sched] 💥 boot-kick error: %s", e)

    scheduler.add_job(
        _boot_kick,
        DateTrigger(run_date=datetime.utcnow() + timedelta(seconds=3)),
        id="boot-kick", replace_existing=True
    )

    def _is_true(v: str) -> bool:
        return (v or "").strip().lower() in {"1", "true", "yes", "on"}

    ENABLE_SCHED = _is_true(os.getenv("ENABLE_SCHEDULER", "true"))
    try:
        if ENABLE_SCHED and not scheduler.running:
            scheduler.start()
            job = scheduler.get_job("push-tick")
            nxt = getattr(job, "next_run_time", None)
            app.logger.info("[sched] ✅ iniciado; next=%s, interval=%ss", nxt, TICK_SECONDS)
        elif not ENABLE_SCHED:
            app.logger.info("[sched] ❎ deshabilitado (ENABLE_SCHEDULER=%s)", os.getenv("ENABLE_SCHEDULER"))
    except Exception as e:
        app.logger.exception("[sched] 💥 no pudo iniciar: %s", e)

    # Exponer un pequeño helper para el endpoint de debug
    def debug_info():
        job = scheduler.get_job("push-tick")
        return {
            "running": bool(getattr(scheduler, "running", False)),
            "next_run": (job.next_run_time.isoformat() if job and job.next_run_time else None),
            "interval_sec": TICK_SECONDS,
        }

    # Devolvemos ambos si los quieres usar
    scheduler.debug_info = debug_info  # type: ignore[attr-defined]
    return scheduler
