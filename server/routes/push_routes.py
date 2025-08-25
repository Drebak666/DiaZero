from flask import Blueprint, request, jsonify, current_app
import requests, json, traceback
from pywebpush import webpush, WebPushException

push_bp = Blueprint("push", __name__, url_prefix="/api/push")

# --- reemplaza tu _supa_headers por este ---
def _supa_headers():
    key = (current_app.config.get("SUPABASE_SERVICE_KEY")
           or current_app.config.get("SUPABASE_API_KEY"))
    if not key:
        raise RuntimeError("Supabase key not configured (SUPABASE_SERVICE_KEY / SUPABASE_API_KEY)")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


# -------------------------------
# DEBUG VAPID
# -------------------------------
@push_bp.get("/_debug/vapid")
def debug_vapid():
    import base64
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    VAPID_PUBLIC  = current_app.config.get("VAPID_PUBLIC")
    VAPID_PRIVATE = current_app.config.get("VAPID_PRIVATE")

    out = {"have_public": bool(VAPID_PUBLIC), "have_private": bool(VAPID_PRIVATE)}
    if not VAPID_PUBLIC or not VAPID_PRIVATE:
        return jsonify({**out, "match": None}), 200

    def pad(s: str) -> str:
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
        return jsonify({**out, "match": (VAPID_PUBLIC == pub_b64u)})
    except Exception as e:
        return jsonify({**out, "match": None, "error": str(e)}), 500

# -------------------------------
# ENVIAR PUSH
# -------------------------------
@push_bp.post("/send")
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
        sent, failures = 0, []
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
                failures.append({"endpoint_suffix": s["endpoint"][-12:], "status": status, "body": body_txt[:200]})
        return jsonify({"ok": True, "sent": sent, "failed": failures})
    except Exception as e:
        print("[push_send] EXCEPTION:\n", traceback.format_exc())
        return jsonify({"ok": False, "error": str(e)}), 500

# -------------------------------
# SUBSCRIBE
# -------------------------------
@push_bp.post("/subscribe")
def push_subscribe():
    try:
        data = request.get_json(silent=True) or {}
        username = data.get("username")
        endpoint = data.get("endpoint")
        p256dh   = data.get("p256dh")
        auth     = data.get("auth")
        if not all([username, endpoint, p256dh, auth]):
            return jsonify({"ok": False, "error": "faltan campos"}), 400

        SUPABASE_URL = (current_app.config.get("SUPABASE_URL") or "").rstrip("/")
        if not SUPABASE_URL:
            return jsonify({"ok": False, "error": "SUPABASE_URL no configurado"}), 500

        url = f"{SUPABASE_URL}/rest/v1/push_subscriptions"
        r = requests.post(
            url, headers=_supa_headers(),
            json={"username": username, "endpoint": endpoint, "p256dh": p256dh, "auth": auth},
            timeout=10
        )

        if r.status_code == 409:
            ep_q = requests.utils.quote(endpoint, safe='')
            patch_url = f"{url}?endpoint=eq.{ep_q}"
            r = requests.patch(
                patch_url, headers=_supa_headers(),
                json={"username": username, "p256dh": p256dh, "auth": auth},
                timeout=10
            )

        if not (200 <= r.status_code < 300):
            return jsonify({"ok": False, "status": r.status_code, "body": (r.text or "")[:200]}), 502

        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# -------------------------------
# UNSUBSCRIBE
# -------------------------------
@push_bp.post("/unsubscribe")
def push_unsubscribe():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    endpoint = data.get("endpoint")

    SUPABASE_URL = current_app.config["SUPABASE_URL"]
    base = f"{SUPABASE_URL}/rest/v1/push_subscriptions"
    headers = _supa_headers()

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
