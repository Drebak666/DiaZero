from flask import Blueprint, request, jsonify, current_app
import requests, traceback
from datetime import datetime

prefs_bp = Blueprint("prefs", __name__, url_prefix="/api")

def _supa_headers():
    key = current_app.config["SUPABASE_SERVICE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

def to_pg_array(values):
    if not values:
        return "{}"
    try:
        return "{" + ",".join(str(int(v)) for v in values) + "}"
    except Exception:
        return "{}"

def _user_id_for(username: str):
    url = f"{current_app.config['SUPABASE_URL']}/rest/v1/usuarios"
    params = {"select": "id", "username": f"eq.{username}", "limit": "1"}
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.ok and r.json():
        return r.json()[0]["id"]
    return None

# -------------------------------
# PREFERENCIAS (GET)
# -------------------------------
@prefs_bp.get("/notification-prefs")
def get_notification_prefs():
    username = request.args.get("username")
    if not username:
        return jsonify({"error": "username requerido"}), 400

    SUPABASE_URL = current_app.config["SUPABASE_URL"]
    url = f"{SUPABASE_URL}/rest/v1/notification_prefs"
    params = {"select": "username,tasks_lead_min,citas_leads_min", "username": f"eq.{username}", "limit": "1"}
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if not r.ok:
        return jsonify({"error": "supabase_error", "status": r.status_code, "body": r.text}), 502

    row = (r.json() or [{}])[0]
    try:
        tasks_min = -abs(int(row.get("tasks_lead_min", -15)))
    except Exception:
        tasks_min = -15
    try:
        apt = [int(x) for x in row.get("citas_leads_min", [])]
    except Exception:
        apt = []

    prefs = {"routines": {"offsets": [tasks_min]}, "tasks": {"offsets": [tasks_min]}, "appointments": {"offsets": apt}}
    return jsonify({"ok": True, "prefs": prefs})

# -------------------------------
# PREFERENCIAS (POST/UPSERT)
# -------------------------------
@prefs_bp.post("/notification-prefs")
def save_notification_prefs():
    try:
        data = request.get_json(silent=True) or {}
        username = data.get("username")
        tasks    = data.get("tasks", {}).get("offsets", [-15])
        appts    = data.get("appointments", {}).get("offsets", [])
        if not username:
            return jsonify({"ok": False, "error": "username requerido"}), 400

        base = f"{current_app.config['SUPABASE_URL']}/rest/v1/notification_prefs"
        headers = _supa_headers()
        headers["Prefer"] = "resolution=merge-duplicates,return=representation"

        uid = _user_id_for(username)
        payload = {
            "username": username,
            "tasks_lead_min": int(tasks[0]),
            "citas_leads_min": to_pg_array(appts),
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }
        if uid:
            payload["user_id"] = uid

        r = requests.post(base, headers=headers, json=payload, params={"on_conflict": "username"}, timeout=10)
        if not (200 <= r.status_code < 300):
            patch_url = f"{base}?username=eq.{requests.utils.quote(username)}"
            r = requests.patch(patch_url, headers=headers, json=payload, timeout=10)

        return jsonify({"ok": 200 <= r.status_code < 300})
    except Exception as e:
        print("[save_notification_prefs] ERROR:\n", traceback.format_exc())
        return jsonify({"ok": False, "error": str(e)}), 500
