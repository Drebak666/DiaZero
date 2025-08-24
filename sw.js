// sw.js — versión con control de caché/activación inmediata
const CACHE_NAME = 'agenda-v7'; // ↑ súbelo cuando despliegues una nueva versión

self.addEventListener('install', (event) => {
  // activa el SW nuevo sin esperar a cerrar pestañas
  self.skipWaiting();
  // (opcional) precache aquí si quieres: event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll([...]));
});

self.addEventListener('activate', (event) => {
  // limpia caches antiguos y toma control de las páginas abiertas
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Si NO quieres que el HTML quede cacheado por el SW, no añadas handler "fetch".
// (Si ya usabas caching avanzado, mantenlo; si no, mejor así para evitar confusiones.)

// Push (tu código original)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e){}
  const title = data.title || 'Aviso';
  const options = {
    body: data.body || '',
    icon: '/static/icons/icon-192.png',
    badge: '/static/icons/badge-72.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const c of wins) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});
