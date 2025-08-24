import os
import json
import requests
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, send_from_directory, session
from flask_cors import CORS
from dotenv import load_dotenv, find_dotenv
from apscheduler.schedulers.background import BackgroundScheduler
from pytz import utc

# =========================
# Config base
# =========================
load_dotenv(find_dotenv(), override=True)

SUPABASE_URL       = os.getenv("SUPABASE_URL")
SUPABASE_API_KEY   = os.getenv("SUPABASE_API_KEY")                # anon
SUPABASE_SVC_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or SUPABASE_API_KEY
FLASK_SECRET_KEY   = os.getenv("FLASK_SECRET_KEY") or "dev-secret"

# Zona horaria local (una sola vez)
LOCAL_TZ = ZoneInfo(os.getenv("LOCAL_TZ", "Europe/Madrid"))

# Tablas / columnas reales
# --- Citas ---
APPT_TABLE     = "appointments"
APPT_USER_COL  = "usuario"      # text
APPT_DATE_COL  = "date"         # date
APPT_START_COL = "start_time"   # text 'HH:MM'

# --- Tareas ---
TASK_TABLE     = "tasks"
TASK_USER_COL  = "usuario"        # email (text)
TASK_DONE_COL  = "is_completed"
TASK_DATE_COL  = "due_date"       # date
TASK_START_COL = "start_time"     # text "HH:MM"

# --- Rutinas ---
ROUT_TABLE        = "routines"
ROUT_USER_COL     = "usuario"       # email
ROUT_START_COL    = "start_time"    # time (09:00:00)
ROUT_DOW_COL      = "days_of_week"  # jsonb ["Lunes","Martes",...]
ROUT_ACTIVE_COL   = "is_active"     # bool
ROUT_END_DATE_COL = "end_date"      # date (opcional)

# --- Preferencias ---
PREFS_TABLE = "notification_prefs"  # username (text), tasks_lead_min (int), citas_leads_min (int4[])

# --- Registro de envíos (para evitar duplicados) ---
SENT_TABLE  = "notifications_sent"  # username, kind, item_id, offset_min, fired_at

# =========================
# App Flask
# =========================
app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = FLASK_SECRET_KEY
CORS(app)

# ---- VAPID (para /api/push/send en api_routes.py) ----
def _norm(v: str) -> str:
    if not v:
        return ""
    v = v.strip().strip('"').strip("'")
    if v.startswith("{"):
        try:
            v = json.loads(v).get("private_key", "").strip()
        except Exception:
            pass
    return v

VAPID_PUBLIC  = _norm(os.getenv("VAPID_PUBLIC", ""))
VAPID_PRIVATE = _norm(os.getenv("VAPID_PRIVATE", ""))
VAPID_CLAIMS  = {"sub": os.getenv("VAPID_SUB", "mailto:raul@gmail.com")}

app.config.update(
    SUPABASE_URL=SUPABASE_URL,
    SUPABASE_API_KEY=SUPABASE_API_KEY,
    SUPABASE_SERVICE_KEY=SUPABASE_SVC_KEY,
    VAPID_PUBLIC=VAPID_PUBLIC,
    VAPID_PRIVATE=VAPID_PRIVATE,
    VAPID_CLAIMS=VAPID_CLAIMS,
)

# =========================
# Blueprints
# =========================
from server.routes.html_routes import html_bp
from server.routes.api_routes import api_bp

app.register_blueprint(html_bp)
app.register_blueprint(api_bp)

# =========================
# Utilidades varias
# =========================
SPANISH_DOW = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"]
def _today_name_es():
    return SPANISH_DOW[datetime.now(LOCAL_TZ).weekday()]

def _supa_headers(admin: bool = False):
    key = SUPABASE_SVC_KEY if admin else SUPABASE_API_KEY
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

@app.route("/sw.js")
def service_worker():
    return send_from_directory(".", "sw.js", mimetype="application/javascript")

def _parse_hhmm(s: str):
    try:
        hh, mm = map(int, s.strip()[:5].split(":"))
        return hh, mm
    except Exception:
        return None

def _local_to_utc(dt_local: datetime):
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(timezone.utc)

def _iso(dt: datetime):
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")

def _now_utc():
    return datetime.now(timezone.utc)

def _distinct_usernames_with_subs(flask_app):
    url = f"{flask_app.config['SUPABASE_URL']}/rest/v1/push_subscriptions"
    r = requests.get(url, headers=_supa_headers(), params={"select": "username"}, timeout=10)
    r.raise_for_status()
    rows = r.json()
    return sorted(set([row.get("username") for row in rows if row.get("username")]))

def _get_prefs(flask_app, username: str):
    url = f"{flask_app.config['SUPABASE_URL']}/rest/v1/{PREFS_TABLE}"
    params = {"select": "username,tasks_lead_min,citas_leads_min", "username": f"eq.{username}", "limit": "1"}
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)

    tasks_min_default = -15
    apt_default = [-43200, -21600, -1440, -60]

    if not r.ok:
        return {"tasks_lead_min": tasks_min_default, "citas_leads_min": apt_default}

    row = (r.json() or [{}])[0]
    try:
        tasks_min = -abs(int(row.get("tasks_lead_min", tasks_min_default)))
    except Exception:
        tasks_min = tasks_min_default

    try:
        apt = [(-abs(int(x))) for x in (row.get("citas_leads_min") or apt_default)][:3]
    except Exception:
        apt = apt_default

    return {"tasks_lead_min": tasks_min, "citas_leads_min": apt}

def _already_sent(flask_app, username, kind, item_id, offset_min):
    url = f"{flask_app.config['SUPABASE_URL']}/rest/v1/{SENT_TABLE}"
    and_param = f"(username.eq.{username},kind.eq.{kind},offset_min.eq.{int(offset_min)})"
    if item_id:
        and_param = f"(username.eq.{username},kind.eq.{kind},item_id.eq.{item_id},offset_min.eq.{int(offset_min)})"
    r = requests.get(url, headers=_supa_headers(),
                     params={"select": "id", "and": and_param, "limit": 1}, timeout=10)
    return (r.ok and r.json())

def _mark_sent(flask_app, username, kind, item_id, offset_min):
    url = f"{flask_app.config['SUPABASE_URL']}/rest/v1/{SENT_TABLE}"
    payload = {
        "username": username,
        "kind": kind,
        "item_id": item_id,
        "offset_min": int(offset_min),
        "fired_at": _iso(_now_utc()),
    }
    try:
        requests.post(url, headers=_supa_headers(), json=payload, timeout=10)
    except Exception:
        pass

PUSH_BASE = os.getenv("PUSH_BASE_URL", "").rstrip("/")
def _send_push(username, title, body, url="/"):
    try:
        base = PUSH_BASE or "https://environmental-marthe-diazero2-5ab75580.koyeb.app"
        r = requests.post(
            f"{base}/api/push/send",
            json={"username": username, "title": title, "body": body, "url": url},
            timeout=10,
        )
        return r.ok
    except Exception:
        return False


# =========================
# Chequeo de TAREAS
# =========================
def _check_tasks(flask_app, username, tasks_offset_min):
    """Dispara push de TAREA cuando target ∈ (now - tick, now]."""
    base = f"{flask_app.config['SUPABASE_URL']}/rest/v1/{TASK_TABLE}"

    now_utc   = _now_utc()
    tick_s    = TICK_SECONDS
    win_start = now_utc - timedelta(seconds=tick_s)
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
    headers = _supa_headers(admin=True)

    try:
        r = requests.get(base, headers=headers, params=params, timeout=10)
        flask_app.logger.info("[sched] %s tasks off=%s status=%s", username, tasks_offset_min, r.status_code)
        if not r.ok:
            flask_app.logger.warning("[sched] tasks body=%s", r.text[:200])
            return

        for t in (r.json() or []):
            d = t.get(TASK_DATE_COL)
            hhmm = (t.get(TASK_START_COL) or "").strip()
            if not d or not hhmm:
                continue
            try:
                yy, mm, dd = map(int, d.split("-"))
                hh, mi = map(int, hhmm[:5].split(":"))
            except Exception:
                continue

            start_utc = _local_to_utc(datetime(yy, mm, dd, hh, mi))
            target    = start_utc + timedelta(minutes=tasks_offset_min)  # -1 => 1 min antes
            diff      = (now_utc - target).total_seconds()

            flask_app.logger.info("[sched] task id=%s target=%s now=%s diff=%.1fs",
                                  t.get("id"), target, now_utc, diff)

            if win_start <= target <= win_end:
                desc = t.get("description") or "Tarea"
                _send_push(username, "Tarea", f"{desc} • empieza ya", url="/app")
                flask_app.logger.info("[sched] TASK HIT id=%s desc=%s at=%s", t.get("id"), desc, target)
    except Exception as e:
        flask_app.logger.warning("[sched] tasks exception: %s", e)

# =========================
# Chequeo de RUTINAS
# =========================
def _check_routines(flask_app, username, offset_min):
    """Dispara push de RUTINA cuando target ∈ (now - tick, now]."""
    base = f"{flask_app.config['SUPABASE_URL']}/rest/v1/{ROUT_TABLE}"

    now_utc   = _now_utc()
    tick_s    = TICK_SECONDS
    win_start = now_utc - timedelta(seconds=tick_s)
    win_end   = now_utc

    today_local = datetime.now(LOCAL_TZ).date()
    today_name  = _today_name_es()

    select_cols = f"id,description,{ROUT_START_COL},{ROUT_USER_COL},{ROUT_DOW_COL},{ROUT_ACTIVE_COL},{ROUT_END_DATE_COL}"
    params = [
        ("select", select_cols),
        (ROUT_USER_COL, f"eq.{username}"),
        (ROUT_ACTIVE_COL, "eq.true"),
        (ROUT_DOW_COL, "cs." + json.dumps([today_name])),  # days_of_week contiene el de hoy
        ("limit", "100"),
    ]
    headers = _supa_headers(admin=True)

    try:
        r = requests.get(base, headers=headers, params=params, timeout=10)
        flask_app.logger.info("[sched] %s routines off=%s status=%s", username, offset_min, r.status_code)
        if not r.ok:
            flask_app.logger.warning("[sched] routines body=%s", r.text[:200])
            return

        for row in (r.json() or []):
            st = (row.get(ROUT_START_COL) or "").strip()   # "HH:MM:SS"
            if len(st) < 4:
                continue
            hh, mi = map(int, st[:5].split(":"))

            start_utc = _local_to_utc(datetime(today_local.year, today_local.month, today_local.day, hh, mi))
            target    = start_utc + timedelta(minutes=offset_min)
            diff      = (now_utc - target).total_seconds()

            flask_app.logger.info("[sched] routine id=%s target=%s now=%s diff=%.1fs",
                                  row.get("id"), target, now_utc, diff)

            if win_start <= target <= win_end:
                desc = row.get("description") or "Rutina"
                # evita duplicados por id+offset
                if not _already_sent(flask_app, username, "routine", row.get("id"), offset_min):
                    _send_push(username, "Rutina", f"{desc} • empieza ya", url="/app")
                    _mark_sent(flask_app, username, "routine", row.get("id"), offset_min)
    except Exception as e:
        flask_app.logger.warning("[sched] routines exception: %s", e)

# =========================
# Chequeo de CITAS
# =========================
def _check_appointments(flask_app, username, offsets):
    """Busca appointments (usuario/date/start_time) y dispara si cae en ventana."""
    if not offsets:
        return

    base    = f"{flask_app.config['SUPABASE_URL']}/rest/v1/{APPT_TABLE}"
    now_utc = _now_utc()
    win_end = now_utc + timedelta(seconds=TICK_SECONDS)

    # consultamos de ayer a mañana en fecha LOCAL
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

        r = requests.get(base, headers=_supa_headers(admin=True), params=params, timeout=10)
        app.logger.info(f"[sched] {username} {APPT_TABLE} off={off} days={day_min}..{day_max} status={r.status_code}")
        if not r.ok:
            app.logger.warning(f"[sched] body={r.text}")
            continue

        for row in r.json():
            d = row.get(APPT_DATE_COL)      # YYYY-MM-DD
            t = row.get(APPT_START_COL)     # HH:MM
            hhmm = _parse_hhmm(t) if (d and t) else None
            if not hhmm:
                continue

            yy, mm, dd = map(int, d.split("-"))
            hh, mi = hhmm
            event_utc = _local_to_utc(datetime(yy, mm, dd, hh, mi))

            if not (start_from_utc <= event_utc < start_to_utc):
                continue

            item_id = row.get("id")
            if _already_sent(flask_app, username, "appointment", item_id, off):
                continue

            title = row.get("description") or "Cita"
            _send_push(username, f"⏰ {title}", "Recordatorio de cita", "/")
            _mark_sent(flask_app, username, "appointment", item_id, off)

# =========================
# Debug pequeño
# =========================
@app.get("/api/_debug/scheduler")
def debug_scheduler():
    job = scheduler.get_job("push-tick")
    return jsonify({
        "running": scheduler.state == 1,
        "next_run": job.next_run_time.isoformat() if job else None,
        "interval_sec": TICK_SECONDS,
    })

@app.get("/whoami")
def whoami():
    return jsonify({"username": session.get("username"), "role": session.get("role")})

# =========================
# Scheduler
# =========================
TICK_SECONDS = 10  # en prod: 60

def check_and_send():
    """Job que se ejecuta cada TICK_SECONDS."""
    with app.app_context():
        try:
            users = _distinct_usernames_with_subs(app)
            for u in users:
                prefs = _get_prefs(app, u)
                _check_appointments(app, u, prefs["citas_leads_min"])
                _check_tasks(app, u, prefs["tasks_lead_min"])
                _check_routines(app, u, prefs["tasks_lead_min"])   # ← rutinas ACTIVAS
        except Exception as e:
            app.logger.exception("scheduler error: %s", e)

scheduler = BackgroundScheduler(timezone=utc, daemon=True)
scheduler.add_job(
    check_and_send, "interval",
    seconds=TICK_SECONDS,
    id="push-tick",
    replace_existing=True
)

if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    app.logger.info("== Booting Flask + APScheduler ==")
    if not scheduler.running:
        app.logger.info("Starting scheduler…")
        scheduler.start()
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)
