from flask import Blueprint, request, jsonify, session, current_app
import requests, bcrypt, traceback


api_bp = Blueprint("api", __name__, url_prefix="/api")

# -------------------------------
# Helpers
# -------------------------------
def _supa_headers():
    """Usa la SERVICE KEY cargada en app.config."""
    key = current_app.config["SUPABASE_SERVICE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

def _user_id_for(username: str):
    """Devuelve el UUID del usuario (tabla usuarios) para enlazar la preferencia."""
    url = f"{current_app.config['SUPABASE_URL']}/rest/v1/usuarios"
    params = {"select": "id", "username": f"eq.{username}", "limit": "1"}
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.ok and r.json():
        return r.json()[0]["id"]
    return None

# -------------------------------
# PLACEHOLDER
# -------------------------------
@api_bp.get("/usuario")
def obtener_usuario_actual():
    return jsonify({"message": "No implementado"}), 501






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
        return jsonify({"message": "Error de configuración del servidor"}), 500

    supabase_url = f"{SUPABASE_URL}/rest/v1/usuarios"
    params = {"username": f"ilike.{username}"}
    try:
        response = requests.get(supabase_url, headers=_supa_headers(), params=params)
        response.raise_for_status()
    except requests.exceptions.RequestException:
        return jsonify({"message": "Error al conectar con Supabase"}), 500

    users = response.json()
    if not users:
        return jsonify({"message": "Usuario o contraseña incorrectos."}), 401

    user = users[0]
    stored_hash = user.get("password_hash")
    if not stored_hash or not bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8")):
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

    import bcrypt
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
