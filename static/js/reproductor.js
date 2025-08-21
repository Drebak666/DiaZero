// static/js/reproductor.js
import { supabase } from './supabaseClient.js';

const IN_SHELL = window.top !== window.self; // true si estamos en el iframe del shell

// UI
const audioPlayer       = document.getElementById('audio-player');       // puede NO existir (lo hemos quitado)
const currentSongTitle  = document.getElementById('current-song-title'); // puede NO existir (lo hemos quitado)
const songsListEl       = document.getElementById('songs-list');
const searchInput       = document.getElementById('search-input');
const btnRefrescar      = document.getElementById('btn-refrescar');

const btnPrev           = document.getElementById('btn-prev'); // puede no existir
const btnNext           = document.getElementById('btn-next'); // puede no existir

// Estado
let songsBase  = [];
let songsQueue = [];
let currentIndex = 0;

// Helpers
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const STORAGE_KEY = 'player_state_v1';

function publishPlayerState(overridePlaying = null){
  const playing = overridePlaying !== null
    ? !!overridePlaying
    : (audioPlayer && !audioPlayer.paused);

  const payload = {
    queue: songsQueue.map(s => ({ url:s.url, title:s.title, artist:s.artist })),
    index: currentIndex,
    positionSec: (audioPlayer && audioPlayer.currentTime) || 0,
    playing,
    updatedAt: Date.now()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

// Fetch canciones del usuario actual
// Fetch canciones del usuario (parche: sin romper por UUID/email)
// Cargar canciones del usuario actual.
// Si existe la columna `usuario` (email), filtramos por ella.
// Si no existe (error al seleccionar), reintentamos sin ese filtro para no romper.
// Cargar canciones del usuario actual, evitando el 400 permanente
async function fetchSongs(){
  const email = localStorage.getItem('usuario_actual') || '';
  let hasUsuario = localStorage.getItem('music_has_usuario'); // "yes" | "no" | null

  let data = null, error = null;

  // Intento con filtro por email SOLO si no sabemos que falla
  if (hasUsuario !== 'no') {
    ({ data, error } = await supabase
      .from('music')
      .select('id,url,artist,title,created_at,usuario')
      .eq('usuario', email)
      .order('created_at', { ascending: false }));

    if (!error) {
      localStorage.setItem('music_has_usuario', 'yes');
    } else {
      // Memoriza que no existe para no volver a intentarlo
      localStorage.setItem('music_has_usuario', 'no');
      hasUsuario = 'no';
      data = null; // forzar fallback
    }
  }

  // Fallback (sin filtro, ni columna usuario)
  if (!data) {
    ({ data, error } = await supabase
      .from('music')
      .select('id,url,artist,title,created_at')
      .order('created_at', { ascending: false }));
  }

  if (error) {
    console.error('Error cargando música:', error);
    songsBase = [];
  } else {
    const stripExt = (name) => name.replace(/\.[^/.]+$/, '');
    songsBase = (data || []).map(s => ({
      id: s.id,
      url: s.url,
      artist: s.artist || 'Desconocido',
      title:  s.title  || stripExt(((s.url || '').split('/').pop()) || 'Sin título'),
    }));
  }
  aplicarFiltro();
}


// Render de la lista
function renderSongs(songs){
  if (!songsListEl) return;

  if (!songs.length) {
    songsListEl.innerHTML = `<li class="text-center text-gray-400">No hay canciones.</li>`;
    return;
  }

  songsListEl.innerHTML = songs.map((song, index) => `
    <li class="flex items-center gap-3 bg-gray-800 p-4 rounded-xl shadow-md hover:bg-gray-700 transition-colors">
      <div class="flex-1 min-w-0">
        <div class="text-lg font-semibold text-gray-100 truncate">${esc(song.title)}</div>
        <div class="text-sm text-gray-400 truncate">— ${esc(song.artist || 'Desconocido')}</div>
      </div>
      <div class="flex-shrink-0 flex gap-2">
        <button title="Reproducir"
                data-index="${index}"
                class="play-button w-10 h-10 rounded-full bg-purple-500 hover:bg-purple-600 text-white flex items-center justify-center shadow">
          <i class="fa-solid fa-play"></i>
        </button>
        <button title="Eliminar"
                data-id="${song.id}"
                class="delete-button w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </li>
  `).join('');

  songsListEl.querySelectorAll('.play-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentIndex = parseInt(e.currentTarget.dataset.index, 10);
      playCurrentSong();
    });
  });

  songsListEl.querySelectorAll('.delete-button').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      try{
        const { error } = await supabase.from('music').delete().eq('id', id);
        if (error) throw error;
        await fetchSongs();
      }catch(err){
        console.error('No se pudo borrar la canción', err);
      }
    });
  });
}

function aplicarFiltro(){
  const q = (searchInput?.value || '').toLowerCase().trim();
  songsQueue = songsBase.filter(s =>
    !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
  );
  renderSongs(songsQueue);
  updateNavButtons();
}

function updateNavButtons(){
  const enabled = songsQueue.length > 1;
  [btnPrev, btnNext].forEach(b => {
    if (!b) return;
    b.disabled = !enabled;
    b.classList.toggle('opacity-50', !enabled);
    b.classList.toggle('cursor-not-allowed', !enabled);
  });
}

// Controles (por si los mantienes en el HTML; si no, no pasa nada)
function playNext(){ if (!songsQueue.length) return; currentIndex = (currentIndex + 1) % songsQueue.length; playCurrentSong(); }
function playPrev(){ if (!songsQueue.length) return; currentIndex = (currentIndex - 1 + songsQueue.length) % songsQueue.length; playCurrentSong(); }
btnPrev?.addEventListener('click', playPrev);
btnNext?.addEventListener('click', playNext);

// Reproducir (vía mini-reproductor del shell)
function playCurrentSong(){
  const song = songsQueue[currentIndex];
  if (!song) return;

  // Si hay un título local, actualizarlo; si no, continuar
  if (currentSongTitle) {
    currentSongTitle.textContent = `▶️ ${esc(song.title)} — ${esc(song.artist || 'Desconocido')}`;
  }

  if (IN_SHELL) {
    // Dentro del shell: NO reproducimos <audio> aquí; publicamos estado y reproduce el mini
    if (audioPlayer){
      audioPlayer.pause();
      audioPlayer.src = '';
      audioPlayer.classList.add('hidden');
    }
    publishPlayerState(true);
    updateNavButtons();
    return;
  }

  // (Fallback) fuera del shell: reproducir con <audio> si existiera
  if (!audioPlayer) return;
  audioPlayer.src = song.url;
  audioPlayer.classList.remove('hidden');
  audioPlayer.play().catch(()=>{});
  audioPlayer.onended = () => playNext();

  updateNavButtons();
  publishPlayerState();
}

// Eventos del <audio> (si existiera)
audioPlayer?.addEventListener('play',  () => publishPlayerState());
audioPlayer?.addEventListener('pause', () => publishPlayerState());
audioPlayer?.addEventListener('timeupdate', () => {
  if (!window.__pp_last || Date.now() - window.__pp_last > 2000) {
    window.__pp_last = Date.now();
    publishPlayerState();
  }
});

// Buscador / refrescar
searchInput?.addEventListener('input', aplicarFiltro);
btnRefrescar?.addEventListener('click', fetchSongs);

// Init
fetchSongs();


// --- Arrastre del reproductor flotante ---
function initDraggablePlayer() {
  const box = document.getElementById('floating-player');
  const handle = document.getElementById('drag-handle');
  if (!box || !handle) return; // por si este HTML no está en alguna página

  let pointerId = null, startX = 0, startY = 0, boxX = 0, boxY = 0;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const setTranslate = (x, y) => {
    box.style.left = '0px';
    box.style.top = '0px';
    box.style.transform = `translate(${x}px, ${y}px)`;
    box.dataset.x = x;
    box.dataset.y = y;
  };

  function restorePosition() {
    const saved = localStorage.getItem('player-pos');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        setTranslate(p.x, p.y);
        return;
      } catch {}
    }
    requestAnimationFrame(() => {
      const x = window.innerWidth - box.offsetWidth - 16;
      const y = window.innerHeight - box.offsetHeight - 16;
      setTranslate(x, y);
    });
  }

  function onPointerDown(e) {
    pointerId = e.pointerId;
    handle.setPointerCapture(pointerId);
    startX = e.clientX; startY = e.clientY;
    boxX = parseFloat(box.dataset.x || '0');
    boxY = parseFloat(box.dataset.y || '0');
    box.classList.add('dragging');
  }
  function onPointerMove(e) {
    if (pointerId === null) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const newX = clamp(boxX + dx, 4, window.innerWidth - box.offsetWidth - 4);
    const newY = clamp(boxY + dy, 4, window.innerHeight - box.offsetHeight - 4);
    setTranslate(newX, newY);
  }
  function onPointerUp() {
    if (pointerId === null) return;
    handle.releasePointerCapture(pointerId);
    pointerId = null;
    box.classList.remove('dragging');
    localStorage.setItem('player-pos', JSON.stringify({
      x: parseFloat(box.dataset.x || '0'),
      y: parseFloat(box.dataset.y || '0')
    }));
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => {
    const x = clamp(parseFloat(box.dataset.x || '0'), 4, Math.max(4, window.innerWidth - box.offsetWidth - 4));
    const y = clamp(parseFloat(box.dataset.y || '0'), 4, Math.max(4, window.innerHeight - box.offsetHeight - 4));
    setTranslate(x, y);
  });

  restorePosition();
}

// Ejecutar cuando el DOM esté listo (el script es type=module)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDraggablePlayer);
} else {
  initDraggablePlayer();
}

/* ====== THEME PATCH: reestiliza la lista sin romper la app ====== */
(function applyPlayerTheme() {
  const rootBody = document.body;
  if (!rootBody) return;

  // Garantizar el scope de estilos
  rootBody.classList.add('theme-player');

  const songsListEl = document.getElementById('songs-list');
  if (!songsListEl) return;

  function restyleLi(li) {
    if (!li || li.dataset.themed === '1') return;

    // Quitar utilidades de Tailwind que fijan colores
    li.classList.remove('bg-gray-800', 'hover:bg-gray-700', 'text-gray-100', 'text-gray-400');
    // Añadir nuestra tarjeta
    li.classList.add('player-card');

    // Títulos y artista (si existen)
    const title = li.querySelector('.song-title') || li.querySelector('.title') || li.querySelector('h4');
    if (title) title.classList.add('song-title');
    const artist = li.querySelector('.song-artist') || li.querySelector('.artist') || li.querySelector('small');
    if (artist) artist.classList.add('song-artist');

    // Botones play / delete (por icono)
    const playBtn = li.querySelector('.fa-play, .fa-solid.fa-play, [title="Reproducir"]')?.closest('button');
    if (playBtn) {
      playBtn.classList.add('play-button');
      playBtn.classList.remove('bg-gray-800', 'hover:bg-gray-700');
    }
    const delBtn = li.querySelector('.fa-trash, .fa-solid.fa-trash, [title="Eliminar"]')?.closest('button');
    if (delBtn) {
      delBtn.classList.add('delete-button');
      delBtn.classList.remove('bg-gray-800', 'hover:bg-gray-700');
    }

    li.dataset.themed = '1';
  }

  function restyleAll() {
    songsListEl.querySelectorAll('li').forEach(restyleLi);
  }

  // 1ª pasada
  restyleAll();

  // Y observar cambios posteriores de render
  const mo = new MutationObserver(() => restyleAll());
  mo.observe(songsListEl, { childList: true, subtree: true });
})();
