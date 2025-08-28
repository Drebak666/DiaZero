from flask import Blueprint, request, jsonify, current_app
import requests, json, traceback
from pywebpush import webpush, WebPushException

push_bp = Blueprint("push", __name__, url_prefix="/api/push")

def _supa_headers():
    key = (current_app.config.get("SUPABASE_SERVICE_KEY")
           or current_app.config.get("SUPABASE_API_KEY"))
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

def _resolve_uid_from_username(username: str | None) -> str | None:
    if not username:
        return None
    try:
        base = current_app.config["SUPABASE_URL"].rstrip("/")
        r = requests.get(
            f"{base}/rest/v1/usuarios",
            headers=_supa_headers(),
            params={"select": "id", "username": f"eq.{username}", "limit": "1"},
            timeout=10
        )
        if r.ok and r.json():
            return r.json()[0]["id"]
    except Exception:
        pass
    return None

@push_bp.post("/subscribe")
def push_subscribe():
    try:
        data = request.get_json(silent=True) or {}
        # aceptar user_id o username por compatibilidad
        user_id  = data.get("user_id") or _resolve_uid_from_username(data.get("username"))
        endpoint = data.get("endpoint")
        p256dh   = data.get("p256dh")
        auth     = data.get("auth")

        # LOG útil
        current_app.logger.info("[push/subscribe] payload %s",
                                {"user_id": user_id, "has_ep": bool(endpoint), "has_p256dh": bool(p256dh), "has_auth": bool(auth)})

        missing = []
        if not user_id:  missing.append("user_id")
        if not endpoint: missing.append("endpoint")
        if not p256dh:   missing.append("p256dh")
        if not auth:     missing.append("auth")
        if missing:
            return jsonify({"ok": False, "error": f"faltan campos: {', '.join(missing)}"}), 400

        base = f"{current_app.config['SUPABASE_URL'].rstrip('/')}/rest/v1/push_subscriptions"
        r = requests.post(base, headers=_supa_headers(),
                          json={"user_id": user_id, "endpoint": endpoint, "p256dh": p256dh, "auth": auth},
                          timeout=10)
        if r.status_code == 409:
            ep_q = requests.utils.quote(endpoint, safe="")
            r = requests.patch(f"{base}?endpoint=eq.{ep_q}", headers=_supa_headers(),
                               json={"user_id": user_id, "p256dh": p256dh, "auth": auth}, timeout=10)
        if not (200 <= r.status_code < 300):
            return jsonify({"ok": False, "status": r.status_code, "body": (r.text or '')[:200]}), 502
        return jsonify({"ok": True})
    except Exception:
        current_app.logger.exception("push_subscribe error")
        return jsonify({"ok": False, "error": "server_error"}), 500

@push_bp.post("/send")
def push_send():
    try:
        data = request.get_json(silent=True) or {}
        user_id  = data.get("user_id") or _resolve_uid_from_username(data.get("username"))
        title    = data.get("title", "MiAgenda")
        body     = data.get("body", "Tienes una notificación")
        url_to_open = data.get("url", "/")
        if not user_id:
            return jsonify({"ok": False, "error": "user_id requerido"}), 400

        base = f"{current_app.config['SUPABASE_URL'].rstrip('/')}/rest/v1/push_subscriptions"
        params = {"select": "endpoint,p256dh,auth", "user_id": f"eq.{user_id}"}
        r = requests.get(base, headers=_supa_headers(), params=params, timeout=10)
        if not r.ok:
            return jsonify({"ok": False, "status": r.status_code, "body": r.text}), 502

        subs = r.json() or []
        if not subs:
            return jsonify({"ok": False, "error": "sin suscripciones"}), 404

        payload = {"title": title, "body": body, "url": url_to_open}
        sent, failures = 0, []
        for s in subs:
            try:
                webpush(
                    subscription_info={"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                    data=json.dumps(payload),
                    vapid_private_key=current_app.config["VAPID_PRIVATE"],
                    vapid_claims=current_app.config["VAPID_CLAIMS"],
                    ttl=60
                )
                sent += 1
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                body_txt = getattr(e.response, "text", "")
                failures.append({"endpoint_suffix": s["endpoint"][-12:], "status": status, "body": (body_txt or "")[:200]})
        return jsonify({"ok": True, "sent": sent, "failed": failures})
    except Exception:
        current_app.logger.exception("push_send error")
        return jsonify({"ok": False, "error": "server_error"}), 500

@push_bp.post("/unsubscribe")
def push_unsubscribe():
    try:
        data = request.get_json(silent=True) or {}
        user_id  = data.get("user_id") or _resolve_uid_from_username(data.get("username"))
        endpoint = data.get("endpoint")

        current_app.logger.info("[push/unsubscribe] payload %s", {"user_id": user_id, "has_ep": bool(endpoint)})

        base = f"{current_app.config['SUPABASE_URL'].rstrip('/')}/rest/v1/push_subscriptions"
        if endpoint:
            ep_q = requests.utils.quote(endpoint, safe="")
            url = f"{base}?endpoint=eq.{ep_q}"
        elif user_id:
            uid_q = requests.utils.quote(user_id, safe="")
            url = f"{base}?user_id=eq.{uid_q}"
        else:
            return jsonify({"ok": False, "error": "user_id o endpoint requerido"}), 400

        r = requests.delete(url, headers=_supa_headers(), timeout=10)
        return jsonify({"ok": r.status_code in (200, 204),
                        "status": r.status_code, "body": (r.text or "")[:200]})
    except Exception:
        current_app.logger.exception("push_unsubscribe error")
        return jsonify({"ok": False, "error": "server_error"}), 500
