// sw.js — Service Worker de tu PWA (push VAPID)

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e){}

  const title = data.title || 'Aviso';
  const options = {
    body: data.body || '',
    icon: '/static/icons/icon-192.png',   // ajusta rutas de iconos si usas otras
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
