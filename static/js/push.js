// static/js/push.js
export async function enablePush(username) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push no soportadas en este dispositivo/navegador');
      return false;
    }

    const reg = await navigator.serviceWorker.ready;

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.warn('Permiso de notificaciones no concedido');
      return false;
    }

    // ⚠️ Pega aquí tu clave pública VAPID (la de .env VAPID_PUBLIC)
    const VAPID_PUBLIC_KEY = 'BLtN98ZtEtdv07o2x_s1isjdYPUdH7VHdL5_cAf0ldKxkVFLQhEeCDE16gJSNwv7Wh40NKJzTksKA1yMvBMjToI';

    const applicationServerKey = (function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64);
      const output = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
      return output;
    })(VAPID_PUBLIC_KEY);

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    const { endpoint, keys } = sub.toJSON();

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
      })
    });

    if (!res.ok) {
      console.error('Fallo al guardar suscripción:', res.status, await res.text());
      return false;
    }

    console.log('Suscripción push guardada correctamente');
    return true;
  } catch (err) {
    console.error('enablePush error:', err);
    return false;
  }
}

// ✅ además de exportarla, la colgamos en el global por si la quieres desde consola
try {
  if (typeof window !== 'undefined') window.enablePush = enablePush;
  if (typeof globalThis !== 'undefined') globalThis.enablePush = enablePush;
} catch(_) {}
