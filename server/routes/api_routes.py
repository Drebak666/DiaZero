# server/routes/api_routes.py
from flask import Blueprint, request, jsonify, session, current_app
import requests, bcrypt, traceback, json
from pywebpush import webpush, WebPushException
from datetime import datetime

api_bp = Blueprint("api", __name__, url_prefix="/api")

# -------------------------------
# Helpers
# -------------------------------
def _user_id_for(username: str):
    """Devuelve el UUID del usuario (tabla usuarios) para enlazar la preferencia."""
    url = f"{current_app.config['SUPABASE_URL']}/rest/v1/usuarios"
    params = {"select": "id", "username": f"eq.{username}", "limit": "1"}
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.ok and r.json():
        return r.json()[0]["id"]
    return None

def _supa_headers():
    """Usa la SERVICE KEY cargada en app.config."""
    key = current_app.config["SUPABASE_SERVICE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

def to_pg_array(values):
    """Convierte lista Python en array Postgres '{...}'."""
    if not values:
        return "{}"
    try:
        return "{" + ",".join(str(int(v)) for v in values) + "}"
    except Exception:
        return "{}"

# (opcional) Autodetectar columna de identidad en notification_prefs
def _prefs_id_col():
    col = current_app.config.get("NOTIF_PREFS_COL")
    if col:
        return col
    SUPABASE_URL = current_app.config["SUPABASE_URL"]
    base = f"{SUPABASE_URL}/rest/v1/notification_prefs"
    headers = _supa_headers()
    for candidate in ("username", "email", "usuario"):
        try:
            r = requests.get(
                base,
                headers=headers,
                params={"select": "*", candidate: "eq.__probe__", "limit": "1"},
                timeout=8,
            )
            if r.status_code != 400:  # 400 = la columna no existe
                current_app.config["NOTIF_PREFS_COL"] = candidate
                return candidate
        except Exception:
            pass
    current_app.config["NOTIF_PREFS_COL"] = "username"
    return "username"

# -------------------------------
# PLACEHOLDER
# -------------------------------
@api_bp.get("/usuario")
def obtener_usuario_actual():
    return jsonify({"message": "No implementado"}), 501

# -------------------------------
# DEBUG VAPID
# -------------------------------
@api_bp.get("/_debug/vapid")
def debug_vapid():
    import base64
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    VAPID_PUBLIC  = current_app.config.get("VAPID_PUBLIC")
    VAPID_PRIVATE = current_app.config.get("VAPID_PRIVATE")

    out = {
        "have_public": bool(VAPID_PUBLIC),
        "have_private": bool(VAPID_PRIVATE),
        "len_public": len(VAPID_PUBLIC or ""),
        "len_private": len(VAPID_PRIVATE or "")
    }
    if not VAPID_PUBLIC or not VAPID_PRIVATE:
        return jsonify({**out, "match": None, "note": "faltan claves en .env"}), 200

    def pad(s: str) -> str:
        s = (s or "").strip()
        return s + ("=" * ((4 - (len(s) % 4)) % 4))

    try:
        priv_bytes = base64.urlsafe_b64decode(pad(VAPID_PRIVATE))
        priv_int = int.from_bytes(priv_bytes, "big")
        priv = ec.derive_private_key(priv_int, ec.SECP256R1())

        pub_bytes = priv.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint
        )
        pub_b64u = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()

        return jsonify({**out, "match": (VAPID_PUBLIC == pub_b64u), "public_prefix": (VAPID_PUBLIC or "")[:16]})
    except Exception as e:
        return jsonify({**out, "match": None, "error": str(e)}), 500

# -------------------------------
# ENVIAR PUSH
# -------------------------------
@api_bp.post("/push/send")
def push_send():
    try:
        data = request.get_json(silent=True) or {}
        username = data.get("username")
        title = data.get("title", "MiAgenda")
        body  = data.get("body", "Tienes una notificación")
        url_to_open = data.get("url", "/")
        if not username:
            return jsonify({"ok": False, "error": "username requerido"}), 400

        SUPABASE_URL      = current_app.config["SUPABASE_URL"]
        SUPABASE_API_KEY  = current_app.config["SUPABASE_API_KEY"]
        VAPID_PRIVATE     = current_app.config["VAPID_PRIVATE"]
        VAPID_CLAIMS      = current_app.config["VAPID_CLAIMS"]

        base = f"{SUPABASE_URL}/rest/v1/push_subscriptions"
        params = {"select": "endpoint,p256dh,auth", "username": f"eq.{username}"}
        headers = {"apikey": SUPABASE_API_KEY, "Authorization": f"Bearer {SUPABASE_API_KEY}"}
        r = requests.get(base, headers=headers, params=params, timeout=10)
        if not r.ok:
            return jsonify({"ok": False, "status": r.status_code, "body": r.text}), 502

        subs = r.json()
        if not subs:
            return jsonify({"ok": False, "error": "sin suscripciones"}), 404

        payload = {"title": title, "body": body, "url": url_to_open}
        sent = 0
        failures = []
        for s in subs:
            try:
                webpush(
                    subscription_info={"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                    data=json.dumps(payload),
                    vapid_private_key=VAPID_PRIVATE,
                    vapid_claims=VAPID_CLAIMS,
                    ttl=60
                )
                sent += 1
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                body_txt = getattr(e.response, "text", "")
                if status in (404, 410):
                    try:
                        requests.delete(base, headers=headers, params={"endpoint": f"eq.{s['endpoint']}"}, timeout=10)
                    except Exception:
                        pass
                failures.append({
                    "endpoint_suffix": s["endpoint"][-12:],
                    "status": status,
                    "body": (body_txt or "")[:200],
                    "error": str(e),
                    "type": e.__class__.__name__,
                })
        return jsonify({"ok": True, "sent": sent, "failed": failures})
    except Exception as e:
        print("[push_send] EXCEPTION:\n", traceback.format_exc())
        return jsonify({"ok": False, "error": str(e)}), 500

# -------------------------------
# GUARDAR SUBSCRIPCIÓN
# -------------------------------
@api_bp.post("/push/subscribe")
def push_subscribe():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    endpoint = data.get("endpoint")
    p256dh   = data.get("p256dh")
    auth     = data.get("auth")
    if not all([username, endpoint, p256dh, auth]):
        return jsonify({"ok": False, "error": "faltan campos"}), 400

    SUPABASE_URL = current_app.config["SUPABASE_URL"]
    url = f"{SUPABASE_URL}/rest/v1/push_subscriptions"
    r = requests.post(url, headers=_supa_headers(),
                      json={"username": username, "endpoint": endpoint, "p256dh": p256dh, "auth": auth},
                      timeout=10)
    if r.status_code == 409:
        endpoint_q = requests.utils.quote(endpoint, safe='')
        patch_url = f"{url}?endpoint=eq.{endpoint_q}"
        r = requests.patch(patch_url, headers=_supa_headers(),
                           json={"username": username, "p256dh": p256dh, "auth": auth}, timeout=10)
    if not (200 <= r.status_code < 300):
        return jsonify({"ok": False, "status": r.status_code, "body": r.text}), 502
    return jsonify({"ok": True})

# -------------------------------
# LOGIN / REGISTER / SESSION
# -------------------------------
@api_bp.post("/login")
def api_login():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify({"message": "Usuario y contraseña son requeridos"}), 400

    SUPABASE_URL     = current_app.config["SUPABASE_URL"]
    SUPABASE_API_KEY = current_app.config["SUPABASE_API_KEY"]
    if not SUPABASE_URL or not SUPABASE_API_KEY:
        return jsonify({"message": "Error de configuración del servidor: Claves de Supabase no encontradas."}), 500

    supabase_url = f"{SUPABASE_URL}/rest/v1/usuarios"
    params = {"username": f"ilike.{username}"}
    try:
        response = requests.get(supabase_url, headers=_supa_headers(), params=params)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"Error al conectar con Supabase: {e}")
        return jsonify({"message": "Error al conectar con el servicio de autenticación."}), 500

    users = response.json()
    if not users:
        return jsonify({"message": "Usuario o contraseña incorrectos."}), 401

    user = users[0]
    stored_hash = user.get("password_hash")
    if not stored_hash:
        return jsonify({"message": "Error de configuración del usuario: Hash de contraseña no encontrado."}), 500

    if not bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8")):
        return jsonify({"message": "Usuario o contraseña incorrectos."}), 401

    session["user_id"]  = user["id"]
    session["username"] = user["username"]
    session["role"]     = user.get("role", "user")
    return jsonify({"message": "Login correcto", "username": user["username"], "user_id": user["id"]}), 200

@api_bp.post("/register")
def api_register():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    role     = data.get("role", "user")
    if not username or not password:
        return jsonify({"message": "Usuario y contraseña son requeridos"}), 400

    SUPABASE_URL     = current_app.config["SUPABASE_URL"]
    SUPABASE_API_KEY = current_app.config["SUPABASE_API_KEY"]

    check_url = f"{SUPABASE_URL}/rest/v1/usuarios?username=eq.{username}"
    r = requests.get(check_url, headers=_supa_headers())
    if r.status_code == 200 and r.json():
        return jsonify({"message": "El usuario ya existe"}), 400

    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    payload = {"username": username, "password_hash": hashed, "role": role}
    insert_url = f"{SUPABASE_URL}/rest/v1/usuarios"
    r = requests.post(insert_url, headers=_supa_headers(), json=payload)
    if r.status_code in (200, 201):
        return jsonify({"message": "Usuario registrado correctamente"}), 201
    return jsonify({"message": "Error al registrar el usuario"}), 500

@api_bp.post("/ensure-session")
def ensure_session():
    SUPABASE_URL = current_app.config["SUPABASE_URL"]
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    if not username:
        return jsonify({"error": "username required"}), 400
    try:
        url = f"{SUPABASE_URL}/rest/v1/usuarios"
        params = {"select": "role", "username": f"ilike.{username}"}
        r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
        if not r.ok:
            return jsonify({"error": "supabase_error", "status": r.status_code, "body": r.text}), 502
        rows = r.json()
        if not rows:
            return jsonify({"error": "user not found"}), 404
        session["username"] = username
        session["role"] = rows[0].get("role", "user")
        return jsonify({"ok": True, "role": session["role"]})
    except Exception as e:
        print("[ensure-session] EXCEPTION:\n", traceback.format_exc())
        return jsonify({"error": "server_exception", "detail": str(e)}), 500

# -------------------------------
# DESUSCRIBIR
# -------------------------------
@api_bp.post("/push/unsubscribe")
def push_unsubscribe():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    endpoint = data.get("endpoint")

    SUPABASE_URL = current_app.config["SUPABASE_URL"]
    base = f"{SUPABASE_URL}/rest/v1/push_subscriptions"
    headers = _supa_headers()

    try:
        if endpoint:
            ep_q = requests.utils.quote(endpoint, safe='')
            url = f"{base}?endpoint=eq.{ep_q}"
            r = requests.delete(url, headers=headers, timeout=10)
        elif username:
            url = f"{base}?username=eq.{requests.utils.quote(username)}"
            r = requests.delete(url, headers=headers, timeout=10)
        else:
            return jsonify({"ok": False, "error": "username o endpoint requerido"}), 400

        if r.status_code in (200, 204):
            return jsonify({"ok": True})
        return jsonify({"ok": False, "status": r.status_code, "body": r.text}), 502
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# -------------------------------
# PREFERENCIAS (GET)
# -------------------------------
DEFAULT_APT = [-43200, -21600, -1440, -60]  # 1 mes, 15 días, 1 día, 1 hora

@api_bp.get("/notification-prefs")
def get_notification_prefs():
    username = request.args.get("username")
    if not username:
        return jsonify({"error": "username requerido"}), 400

    SUPABASE_URL = current_app.config["SUPABASE_URL"]
    url = f"{SUPABASE_URL}/rest/v1/notification_prefs"
    params = {
        "select": "username,tasks_lead_min,citas_leads_min",
        "username": f"eq.{username}",
        "limit": "1"
    }
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if not r.ok:
        return jsonify({"error": "supabase_error", "status": r.status_code, "body": r.text}), 502

    rows = r.json()
    row = rows[0] if rows else {}

    # tasks: si no hay valor → -15
    tasks_min_raw = row.get("tasks_lead_min")
    try:
        tasks_min = -abs(int(tasks_min_raw)) if tasks_min_raw is not None else -15
    except Exception:
        tasks_min = -15

    # citas: si no hay valor → lista vacía (NO presets)
    apt_raw = row.get("citas_leads_min")
    try:
        apt = [int(x) for x in apt_raw] if apt_raw is not None else []
    except Exception:
        apt = []

    prefs = {
        "routines":     {"offsets": [int(tasks_min)]},
        "tasks":        {"offsets": [int(tasks_min)]},
        "appointments": {"offsets": apt}
    }
    return jsonify({"ok": True, "prefs": prefs})


# -------------------------------
# PREFERENCIAS (POST/UPSERT)
# -------------------------------
def upsert_notification_prefs(flask_app, username, tasks_min, apt_offsets):
    base = f"{flask_app.config['SUPABASE_URL']}/rest/v1/notification_prefs"
    headers = _supa_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=representation"

    # obtener user_id (muchas tablas de Supabase lo exigen y además te deja todo coherente)
    uid = _user_id_for(username)

    payload = {
        "username": username,
        "tasks_lead_min": int(tasks_min),
        "citas_leads_min": to_pg_array(apt_offsets),  # p.ej. "{-1}"
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    if uid:
        payload["user_id"] = uid  # si la columna existe, mejor rellenarla

    # UPSERT por username
    r = requests.post(
        base,
        headers=headers,
        json=payload,
        params={"on_conflict": "username"},
        timeout=10
    )

    # Si falla el upsert, probamos PATCH por si la fila ya existía sin username exacto
    if not (200 <= r.status_code < 300):
        patch_url = f"{base}?username=eq.{requests.utils.quote(username)}"
        r = requests.patch(patch_url, headers=headers, json=payload, timeout=10)

    # Log de depuración (temporal): deja unas líneas para ver qué contesta Supabase
    try:
        current_app.logger.info("prefs upsert status=%s body=%s", r.status_code, r.text[:200])
    except Exception:
        pass

    return 200 <= r.status_code < 300

@api_bp.post("/notification-prefs")
def save_notification_prefs():
    try:
        data = request.get_json(silent=True) or {}
        username = data.get("username")
        tasks    = data.get("tasks", {}).get("offsets", [-15])
        appts    = data.get("appointments", {}).get("offsets", [])

        if not username:
            return jsonify({"ok": False, "error": "username requerido"}), 400

        ok = upsert_notification_prefs(current_app, username, int(tasks[0]), appts)
        return jsonify({"ok": ok})
    except Exception as e:
        print("[save_notification_prefs] ERROR:\n", traceback.format_exc())
        return jsonify({"ok": False, "error": str(e)}), 500
