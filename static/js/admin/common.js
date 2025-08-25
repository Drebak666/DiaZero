// Utilidades comunes
export const $ = (s) => document.querySelector(s);

export function getUsername() {
  return localStorage.getItem('usuario_actual') || 'raul@gmail.com';
}

export function readVapidPublic() {
  // lee del <meta name="vapid-public"> o de window.VAPID_PUBLIC
  const meta = document.querySelector('meta[name="vapid-public"]');
  return (meta?.content || window.VAPID_PUBLIC || '').trim();
}

export function toUint8(b64u) {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const s = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
