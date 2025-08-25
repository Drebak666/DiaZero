import { $, getUsername, readVapidPublic, toUint8 } from './common.js';

const statusEl = $('#notify-status');
const username = getUsername();
const VAPID_PUBLIC = readVapidPublic();

async function pushStatus() {
  try {
    if (!('serviceWorker' in navigator)) {
      statusEl.textContent = 'Estado: SW no disponible';
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const perm = Notification.permission;
    statusEl.textContent = sub ? `Estado: ✅ suscrito (${perm})` : `Estado: ⚠️ no suscrito (${perm})`;
  } catch (e) {
    statusEl.textContent = 'Estado: error';
    console.error(e);
  }
}

async function subscribe() {
  try {
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { statusEl.textContent = 'Permiso denegado'; return; }
    }
    const reg = await navigator.serviceWorker.ready;

    const old = await reg.pushManager.getSubscription();
    if (old) await old.unsubscribe();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8(VAPID_PUBLIC),
    });

    const s = sub.toJSON();
    const resp = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ username, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(JSON.stringify(data));
    statusEl.textContent = 'Estado: ✅ suscrito';
  } catch (e) {
    console.error('subscribe error', e);
    statusEl.textContent = 'Estado: error al suscribir';
  }
}

async function unsubscribe() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await fetch('/api/push/unsubscribe', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, endpoint })
      });
    }
    statusEl.textContent = 'Estado: ⚠️ no suscrito';
  } catch (e) {
    console.error('unsubscribe error', e);
    statusEl.textContent = 'Estado: error al desuscribir';
  }
}

async function sendTest() {
  try {
    const resp = await fetch('/api/push/send', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ username, title: '🔔 Prueba', body: 'Notificación de prueba', url: '/' })
    });
    const ct = resp.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await resp.json() : await resp.text();
    console.log('push/send ->', resp.status, data);
    if (!resp.ok) alert('Falló el envío: ' + (data.error || resp.status));
  } catch (e) {
    console.error(e);
    alert('Error al enviar');
  }
}

// Hooks de UI
$('#btn-notify-sub')?.addEventListener('click', subscribe);
$('#btn-notify-unsub')?.addEventListener('click', unsubscribe);
$('#btn-notify-test')?.addEventListener('click', sendTest);

// Estado inicial
pushStatus();
