// static/js/push.js  (v8-uid)
console.log('[push.js] v8-uid activo');

async function resolveUid(uidOrUser) {
  if (typeof uidOrUser === 'string' && uidOrUser) return uidOrUser;
  if (uidOrUser && uidOrUser.id) return uidOrUser.id;
  if (window.supabase) {
    const { data: { user } } = await window.supabase.auth.getUser();
    return user?.id || null;
  }
  return null;
}

export async function enablePush(uidOrUser) {
  try {
    const user_id = await resolveUid(uidOrUser);
    if (!user_id) { console.warn('[push] no hay user_id'); return false; }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push no soportadas');
      return false;
    }
    const reg = await navigator.serviceWorker.ready;

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { console.warn('Permiso no concedido'); return false; }

    const VAPID_PUBLIC_KEY = (window.VAPID_PUBLIC
      || document.querySelector('meta[name="vapid-public"]')?.content || '').trim();
    if (!VAPID_PUBLIC_KEY) throw new Error('Falta VAPID_PUBLIC');

    const applicationServerKey = (() => {
      const b64 = (s) => atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g,'+').replace(/_/g,'/'));
      const raw = b64(VAPID_PUBLIC_KEY); const out = new Uint8Array(raw.length);
      for (let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out;
    })();

    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
const json = sub.toJSON ? sub.toJSON() : {};
const endpoint = json.endpoint || sub.endpoint;

// algunas veces json.keys viene undefined → usa getKey()
function keyB64(name) {
  if (json.keys && json.keys[name]) return json.keys[name];
  const ab = sub.getKey ? sub.getKey(name) : null;
  if (!ab) return null;
  const bytes = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
const p256dh = keyB64('p256dh');
const auth   = keyB64('auth');

 console.log('[subscribe] payload →', { user_id, endpoint, p256dh, auth });

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ user_id, endpoint, p256dh, auth })
    });
    if (!res.ok) { console.error('Guardar suscripción falló:', res.status, await res.text()); return false; }

    console.log('Suscripción guardada para', user_id);
    return true;
  } catch (err) { console.error('enablePush error:', err); return false; }
}

export async function sendTest(uidOrUser, title='Ping', body='Prueba') {
  const user_id = await resolveUid(uidOrUser);
  if (!user_id) return console.warn('[push] sendTest: falta user_id');
  console.log('[send] payload →', { user_id, title, body });
  const r = await fetch('/api/push/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id, title, body, url: '/' })
  });
  console.log('push/send ->', r.status, await r.text());
}


export async function unsubscribe(uidOrUser) {
  const user_id = await resolveUid(uidOrUser);
  if (!user_id) return console.warn('[push] unsubscribe: falta user_id');
  const r = await fetch('/api/push/unsubscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id })
  });
  console.log('unsubscribe ->', r.status, await r.text());
}

// accesos rápidos
try { window.enablePush = enablePush; window.sendTestPush = sendTest; window.unsubscribePush = unsubscribe; } catch {}
