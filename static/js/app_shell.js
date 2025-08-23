// Suscripción Web Push (VAPID) → guarda en Flask → Supabase
async function enablePush(username) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push no soportadas en este dispositivo/navegador');
      return false;
    }

    // Asegúrate de que el SW esté listo
    const reg = await navigator.serviceWorker.ready;

    // Pedir permiso
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.warn('Permiso de notificaciones no concedido');
      return false;
    }

    // Tu clave pública VAPID (del .env server, pero aquí se pega literal)
    const VAPID_PUBLIC_KEY = 'BLtN98ZtEtdv07o2x_s1isjdYPUdH7VHdL5_cAf0ldKxkVFLQhEeCDE16gJSNwv7Wh40NKJzTksKA1yMvBMjToI';

    // Convertir clave base64 a Uint8Array
    const applicationServerKey = (function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64);
      const output = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
      return output;
    })(VAPID_PUBLIC_KEY);

    // Suscribir
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    // Serializar y enviar al backend
    const { endpoint, keys } = sub.toJSON();

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,              // el que usas en tu app
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('Fallo al guardar suscripción:', res.status, txt);
      return false;
    }

    console.log('Suscripción push guardada correctamente');
    return true;
  } catch (err) {
    console.error('enablePush error:', err);
    return false;
  }
}
