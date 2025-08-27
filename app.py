# app.py
import os
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, send_from_directory, session
from flask_cors import CORS
from dotenv import load_dotenv, find_dotenv




# =========================
# Carga de configuración
# =========================
load_dotenv(find_dotenv(), override=True)

SUPABASE_URL       = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_API_KEY   = os.getenv("SUPABASE_API_KEY")
SUPABASE_SVC_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or SUPABASE_API_KEY
FLASK_SECRET_KEY   = os.getenv("FLASK_SECRET_KEY") or "dev-secret"
LOCAL_TZ           = ZoneInfo(os.getenv("LOCAL_TZ", "Europe/Madrid"))

# Frecuencia para debug/info del endpoint (el intervalo real vive en server/scheduler.py)
TICK_SECONDS = int(os.getenv("SCHED_TICK_SECONDS", "10"))

# =========================
# App Flask
# =========================
app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = FLASK_SECRET_KEY
CORS(app)

# Logging visible en plataformas tipo Koyeb/Heroku
logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)

# ---- VAPID (para /api/push/send en api_routes) ----
def _norm_vapid(v: str) -> str:
    if not v:
        return ""
    v = v.strip().strip('"').strip("'")
    if v.startswith("{"):
        try:
            v = json.loads(v).get("private_key", "").strip()
        except Exception:
            pass
    return v

VAPID_PUBLIC  = _norm_vapid(os.getenv("VAPID_PUBLIC", ""))
VAPID_PRIVATE = _norm_vapid(os.getenv("VAPID_PRIVATE", ""))
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
from server.routes.api_routes import api_bp
from server.routes.push_routes import push_bp
from server.routes.prefs_routes import prefs_bp
from server.routes.html_routes import html_bp
from server.routes.api_actividades import api_acts
app.register_blueprint(api_acts)
app.register_blueprint(html_bp)
app.register_blueprint(api_bp)
app.register_blueprint(push_bp)
app.register_blueprint(prefs_bp)

# =========================
# Static helpers
# =========================
@app.route("/sw.js")
def service_worker():
    # sirve el Service Worker desde la raíz del repo
    return send_from_directory(".", "sw.js", mimetype="application/javascript")

@app.get("/whoami")
def whoami():
    return jsonify({"username": session.get("username"), "role": session.get("role")})

# =========================
# Scheduler (import y debug)
# =========================
from server.scheduler import create_scheduler  # <- NUEVO
scheduler = create_scheduler(app)             # inicia según ENABLE_SCHEDULER

@app.get("/api/_debug/scheduler")
def debug_scheduler():
    info = getattr(scheduler, "debug_info", lambda: {})()
    return jsonify(info | {"interval_sec": TICK_SECONDS})

# =========================
# Main (solo local)
# =========================
if __name__ == "__main__":
    app.logger.info("== Booting Flask (local) ==")
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)
