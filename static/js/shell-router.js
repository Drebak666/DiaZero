// static/js/shell-router.js
const frame = document.getElementById('app-frame');

// Asegura que toda URL que vaya al iframe lleve plain=1 (evita redireccionar a /app)
function ensurePlain(urlStr) {
  const u = new URL(urlStr, window.location.origin);
  // No tocar rutas del propio shell
  if (u.pathname.startsWith('/app')) return u;
  // Forzar plain=1
  if (!u.searchParams.has('plain')) u.searchParams.set('plain', '1');
  return u;
}

function setFrame(url, replace=false) {
  if (!frame) return;
  const abs = ensurePlain(url);
  frame.src = abs.pathname + abs.search + abs.hash;

  // Refleja en la URL del navegador la ruta abierta en el iframe
  const out = new URL(window.location.href);
  out.searchParams.set('to', frame.src);
  if (replace) history.replaceState({}, '', out);
  else history.pushState({}, '', out);

  // (Opcional) marcar activo en el header si lo muestras
  document.querySelectorAll('header a').forEach(a => {
    const path = new URL(a.href, location.origin).pathname;
    a.classList.toggle('active', path === abs.pathname);
  });
}

// Arranque: si hay ?to=... úsalo; si no, ya pusimos /?plain=1 en app_shell.html
(function init() {
  const u = new URL(window.location.href);
  const to = u.searchParams.get('to');
  if (to) setFrame(to, true);
})();

// Back/forward
window.addEventListener('popstate', () => {
  const u = new URL(window.location.href);
  const to = u.searchParams.get('to') || '/?plain=1';
  if (frame) frame.src = to;
});

// Clicks en el header del shell (si lo dejas visible)
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  if (a.hasAttribute('data-hard') || a.target === '_blank') return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  setFrame(url.href);
});

// Clicks DENTRO del iframe → navegar sin recargar el shell
frame?.addEventListener('load', () => {
  const doc = frame.contentDocument;
  if (!doc) return;

  try { document.title = doc.title || document.title; } catch {}

  doc.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.origin);
    if (url.origin !== location.origin) return; // externos: dejar
    e.preventDefault();
    setFrame(url.href);
  }, true);
});
