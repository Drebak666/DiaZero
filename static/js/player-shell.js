// static/js/player-shell.js
// Reproduce por toda la web leyendo estado desde localStorage.
// Clave de estado compartido:
const STORAGE_KEY = 'player_state_v1';

// UI
const el = {
  shell:  document.getElementById('mini-player'),
  prev:   document.getElementById('mini-prev'),
  play:   document.getElementById('mini-play'),
  next:   document.getElementById('mini-next'),
  title:  document.getElementById('mini-title'),
  hide:   document.getElementById('mini-hide'),
};

// Audio invisible (propio del shell)
let audio = document.getElementById('global-audio');
if (!audio) {
  audio = document.createElement('audio');
  audio.id = 'global-audio';
  audio.style.display = 'none';
  document.body.appendChild(audio);
}

// Estado en memoria
let queue = [];
let index = 0;
let playing = false;
let lastUpdate = 0;

// Helpers
const esc = s => (s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function showShell(show = true){ el.shell?.classList.toggle('show', !!show); }
function setIcon(){
  const i = el.play?.querySelector('i');
  if (!i) return;
  i.className = audio.paused ? 'fa-solid fa-play' : 'fa-solid fa-pause';
}
function saveProgress(){
  // Escribimos cada ~2s para no machacar demasiado
  const now = Date.now();
  if (now - lastUpdate < 2000) return;
  lastUpdate = now;
  persistState();
}
function persistState(){
  const payload = {
    queue: queue.map(s => ({ url:s.url, title:s.title, artist:s.artist })),
    index,
    positionSec: audio.currentTime || 0,
    playing: !audio.paused,
    updatedAt: Date.now()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function formatTitle(s){ return s ? `${s.title} — ${s.artist || 'Desconocido'}` : ''; }

// Reproducir una pista de la cola
async function playFromQueue(i, optResume = true){
  if (!queue.length) return;
  index = (i + queue.length) % queue.length;
  const tr = queue[index];
  if (!tr) return;
  el.title.textContent = formatTitle(tr);
  audio.src = tr.url;

  // Si venimos de un estado con posición guardada y es la misma pista, tratamos de reanudar
  const st = loadState();
  if (optResume && st && st.queue?.[st.index]?.url === tr.url) {
    let pos = Number(st.positionSec) || 0;
    if (st.playing && st.updatedAt) {
      // Añadimos el tiempo transcurrido desde que se guardó
      pos += Math.max(0, (Date.now() - st.updatedAt) / 1000);
    }
    audio.currentTime = pos;
  } else {
    audio.currentTime = 0;
  }

  await audio.play().catch(() => {});
  setIcon();
  showShell(true);
  persistState();
}

// Controles
function playNext(){ if (!queue.length) return; playFromQueue(index + 1, false); }
function playPrev(){ if (!queue.length) return; playFromQueue(index - 1, false); }

// Eventos UI
el.prev?.addEventListener('click', playPrev);
el.next?.addEventListener('click', playNext);
el.play?.addEventListener('click', async () => {
  if (audio.paused) await audio.play().catch(()=>{}); else audio.pause();
  setIcon(); persistState();
});
el.hide?.addEventListener('click', () => showShell(false));

// Eventos audio
audio.addEventListener('play',  () => { setIcon(); persistState(); });
audio.addEventListener('pause', () => { setIcon(); persistState(); });
audio.addEventListener('timeupdate', saveProgress);
audio.addEventListener('ended', playNext);

// Sincronización por cambios en localStorage (p.ej. al venir de /reproductor)
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  bootFromState(); // recarga estado y reanuda si toca
});

// Arranque: lee estado y continúa
// Arranque: lee estado y continúa
function bootFromState(){
  const st = loadState();

  // Mostrar el mini aunque aún no haya cola
  if (!st || !st.queue?.length) {
    showShell(true);
    el.title.textContent = '—';
    setIcon();
    return;
  }

  queue = st.queue;
  index = Math.min(Math.max(0, st.index|0), queue.length - 1);

  const track = queue[index];
  el.title.textContent = `${track.title} — ${track.artist || 'Desconocido'}`;
  audio.src = track.url;

  // Reanudar posición compensando tiempo transcurrido
  let pos = Number(st.positionSec) || 0;
  if (st.playing && st.updatedAt) {
    pos += Math.max(0, (Date.now() - st.updatedAt) / 1000);
  }
  audio.currentTime = pos;

  showShell(true);
  if (st.playing) audio.play().catch(()=>{});
  setIcon();
}


bootFromState();

// Exponer para depurar (opcional)
// window.PlayerShell = { playNext, playPrev, bootFromState };
