// static/js/player-shell.js
// Mini-reproductor global. Lee estado desde localStorage y resuelve pistas locales (IndexedDB).

const STORAGE_KEY = 'player_state_v1';

// -------- UI ----------
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

// -------- Estado ----------
let queue = [];                 // [{ url? , title, artist, kind?, id? }]
let index = 0;
let lastUpdate = 0;
let __currentBlobUrl = null;    // para revocar URLs locales

// -------- Helpers ----------
function showShell(show = true){ el.shell?.classList.toggle('show', !!show); }
function setIcon(){
  const i = el.play?.querySelector('i');
  if (!i) return;
  i.className = audio.paused ? 'fa-solid fa-play' : 'fa-solid fa-pause';
}
function loadState(){
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function persistState(){
  const payload = {
    queue,                                     // guardamos tal cual (con kind/id si existen)
    index,
    positionSec: audio.currentTime || 0,
    playing: !audio.paused,
    updatedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
function saveProgress(){
  const now = Date.now();
  if (now - lastUpdate < 2000) return;
  lastUpdate = now;
  persistState();
}

// IndexedDB (para pistas locales)
function openLocalDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('music_local_db', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function getLocalTrackBlob(id) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const s = db.transaction('local_tracks', 'readonly').objectStore('local_tracks').get(id);
    s.onsuccess = () => resolve(s.result?.blob || null);
    s.onerror   = () => reject(s.error);
  });
}

// Resolver URL de la pista actual (remota o local)
async function resolveTrackUrl(track) {
  if (track.url) return track.url; // remota / ya resuelta
  if (track.kind === 'local-idb' && track.id != null) {
    const blob = await getLocalTrackBlob(track.id);
    if (!blob) return null;
    // Revoca la anterior si hubiera
    if (__currentBlobUrl) { try { URL.revokeObjectURL(__currentBlobUrl); } catch {} }
    __currentBlobUrl = URL.createObjectURL(blob);
    return __currentBlobUrl;
  }
  return null;
}
function formatTitle(t){ return t ? `${t.title} — ${t.artist || 'Desconocido'}` : '—'; }

// -------- Core: reproducir desde la cola ----------
async function playFromQueue(i, resume = true, autoplay = true){
  if (!queue.length) return;
  index = (i + queue.length) % queue.length;

  const tr = queue[index];
  if (!tr) return;

  el.title.textContent = formatTitle(tr);

  const url = await resolveTrackUrl(tr);
  if (!url) return;

  audio.src = url;

  const st = loadState();
  if (resume && st && st.index === index) {
    let pos = Number(st.positionSec) || 0;
    try { audio.currentTime = pos; } catch {}
  } else {
    audio.currentTime = 0;
  }

  if (autoplay) {
    await audio.play().catch(()=>{});
  }

  setIcon();
  showShell(true);
  persistState();
}


function playNext(){ if (!queue.length) return; playFromQueue(index + 1, false); }
function playPrev(){ if (!queue.length) return; playFromQueue(index - 1, false); }

// -------- UI handlers ----------
el.prev?.addEventListener('click', playPrev);
el.next?.addEventListener('click', playNext);
el.play?.addEventListener('click', async () => {
  if (audio.paused) await audio.play().catch(()=>{}); else audio.pause();
  setIcon(); persistState();
});
el.hide?.addEventListener('click', () => showShell(false));

// -------- Audio events ----------
audio.addEventListener('play',  () => { setIcon(); persistState(); });
audio.addEventListener('pause', () => { setIcon(); persistState(); });
audio.addEventListener('timeupdate', saveProgress);
audio.addEventListener('ended', playNext);

// -------- Sincronizar por cambios en localStorage --------
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  bootFromState();
});

// -------- Arranque --------
async function bootFromState(){
  const st = loadState();

  if (!st || !st.queue?.length) {
    showShell(true);
    el.title.textContent = '—';
    setIcon();
    return;
  }

  queue = Array.isArray(st.queue) ? st.queue : [];
  index = Math.min(Math.max(0, st.index|0), queue.length - 1);

  // Si el último estado era "playing", arrancamos
  const autoplay = !!st.playing;
  await playFromQueue(index, true, autoplay);
}

bootFromState();

// Exponer API para otros scripts (por ejemplo, reproductor-local.js)
window.PlayerShell = { playNext, playPrev, bootFromState };
