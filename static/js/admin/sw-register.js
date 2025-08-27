// Registro del Service Worker
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/sw.js?v=20250824', { scope: '/' })
    .then(reg => {
      console.log('[admin] SW registrado:', reg.scope);
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    })
    .catch(err => console.error('[admin] Error registrando SW:', err));
})();
