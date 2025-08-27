// static/js/reproductor-local.js
// Añade música local (en este dispositivo) y la manda al mini-reproductor del shell.
// Sube a Supabase solo cuando tú lo pidas.

import { supabase } from './supabaseClient.js';

// ===== IndexedDB mínima =====
const DB_NAME = 'music_local_db';
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('local_tracks')) {
        const s = db.createObjectStore('local_tracks', { keyPath: 'id', autoIncrement: true });
        s.createIndex('created_at', 'created_at');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }
const idbAll = (st) => new Promise((res, rej) => { const r = tx(st,'readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbAdd = (st, v) => new Promise((res, rej) => { const r = tx(st,'readwrite').add(v); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbDel = (st, k) => new Promise((res, rej) => { const r = tx(st,'readwrite').delete(k); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

// ===== Utilidades =====
const $ = (s) => document.querySelector(s);
const username = () => localStorage.getItem('usuario_actual') || '';
function parseFromFilename(filename) {
  const base = filename.replace(/\.[^/.]+$/, '').trim();
  const parts = base.split(/\s*[-–—]\s*/);
  if (parts.length >= 2) return { artist: parts[0].trim() || 'Desconocido', title: parts.slice(1).join(' - ').trim() || base };
  return { artist: 'Desconocido', title: base };
}
function connectionOK(onlyWifi=true) {
  const c = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
  if (!c) return true;
  if (c.saveData) return false;
  if (onlyWifi) return (c.type === 'wifi') || (c.effectiveType && ['4g','5g'].includes(c.effectiveType));
  return true;
}

// Empuja una COLA al mini-reproductor usando IDs locales (no blob URLs)
async function pushLocalIdsToMini(ids, startIndex = 0) {
  const all = await idbAll('local_tracks');
  const queue = ids.map(id => {
    const it = all.find(x => x.id === id) || {};
    return {
      kind: 'local-idb',         // el shell sabrá que debe resolver desde IndexedDB
      id,
      title: it.title || it.name || 'Sin título',
      artist: it.artist || 'Desconocido'
    };
  });
  const payload = {
    queue,
    index: startIndex,
    positionSec: 0,
    playing: true,
    updatedAt: Date.now()
  };
  localStorage.setItem('player_state_v1', JSON.stringify(payload));
  window.PlayerShell?.bootFromState();
}

// ===== UI: inserta “Música local” debajo de la lista existente =====
function injectUI() {
  const anchorList = $('#songs-list');
  if (!anchorList) return;

  const sec = document.createElement('section');
  sec.className = 'mt-6';
  sec.innerHTML = `
    <h2 class="text-lg font-semibold mb-2">Música local (en este dispositivo)</h2>
    <div class="flex items-center gap-2 mb-3">
      <input id="ml-file" type="file" accept="audio/*" multiple class="hidden" />
      <button id="ml-add" class="bg-indigo-600 text-white px-3 py-2 rounded-md">Añadir del móvil</button>
      <button id="ml-upload" class="bg-teal-600 text-white px-3 py-2 rounded-md">Subir ahora</button>
      <button id="ml-wifi" class="bg-slate-600 text-white px-3 py-2 rounded-md">Solo Wi-Fi: <b id="ml-wifi-state">Sí</b></button>
      <button id="ml-playall" class="bg-purple-600 text-white px-3 py-2 rounded-md">▶ Reproducir todo</button>
      <button id="ml-clear" class="bg-rose-600 text-white px-3 py-2 rounded-md">Borrar todo local</button>
    </div>
    <ul id="ml-list" class="flex flex-col gap-2"></ul>
  `;
  anchorList.parentElement.appendChild(sec);

  $('#ml-add').addEventListener('click', () => $('#ml-file').click());
  $('#ml-file').addEventListener('change', onPickFiles);
  $('#ml-upload').addEventListener('click', () => uploadAll());
  $('#ml-wifi').addEventListener('click', () => {
    state.onlyWifi = !state.onlyWifi;
    $('#ml-wifi-state').textContent = state.onlyWifi ? 'Sí' : 'No';
  });
  $('#ml-playall').addEventListener('click', async () => {
    const items = await idbAll('local_tracks');
    if (!items.length) return;
    const ids = items.map(x => x.id);
    await pushLocalIdsToMini(ids, 0);
  });
  $('#ml-clear').addEventListener('click', async () => {
    const all = await idbAll('local_tracks');
    for (const it of all) await idbDel('local_tracks', it.id);
    renderLocal();
  });
}

// ===== Estado local =====
const state = { onlyWifi: true, uploading: false };

// ===== Importar ficheros: guardar en IndexedDB (local) =====
async function onPickFiles(e) {
  const files = [...(e.target.files || [])];
  if (!files.length) return;
  for (const f of files) {
    const meta = parseFromFilename(f.name);
    await idbAdd('local_tracks', {
      name: f.name,
      size: f.size,
      type: f.type || 'audio/mpeg',
      artist: meta.artist,
      title: meta.title,
      created_at: Date.now(),
      blob: f
    });
  }
  e.target.value = '';
  renderLocal();
}

// ===== Render de lista local =====
function renderLocalItem(it) {
  return `
    <li class="flex items-center gap-3 bg-gray-800 p-3 rounded-lg">
      <div class="flex-1 min-w-0">
        <div class="text-gray-100 font-semibold truncate">${it.title}</div>
        <div class="text-gray-400 text-sm truncate">— ${it.artist}</div>
      </div>
      <div class="flex gap-2">
        <button data-id="${it.id}" data-act="play" class="bg-purple-500 hover:bg-purple-600 text-white w-9 h-9 rounded-full flex items-center justify-center"><i class="fa fa-play"></i></button>
        <button data-id="${it.id}" data-act="upload" class="bg-teal-600 hover:bg-teal-700 text-white w-9 h-9 rounded-full flex items-center justify-center"><i class="fa fa-cloud-upload-alt"></i></button>
        <button data-id="${it.id}" data-act="del" class="bg-red-600 hover:bg-red-700 text-white w-9 h-9 rounded-full flex items-center justify-center"><i class="fa fa-trash"></i></button>
      </div>
    </li>
  `;
}

async function renderLocal() {
  const list = $('#ml-list');
  if (!list) return;
  const items = await idbAll('local_tracks');
  if (!items.length) { list.innerHTML = `<li class="text-gray-400">No hay música local.</li>`; return; }
  items.sort((a,b)=>a.created_at-b.created_at);
  list.innerHTML = items.map(renderLocalItem).join('');

  list.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id  = parseInt(e.currentTarget.dataset.id, 10);
      const act = e.currentTarget.dataset.act;

      if (act === 'play') {
        // reproducir esta pista local en el mini-reproductor del shell
        await pushLocalIdsToMini([id], 0);

      } else if (act === 'upload') {
        await uploadOne(id);

      } else if (act === 'del') {
        await idbDel('local_tracks', id);
        renderLocal();
      }
    });
  });
}

// ===== Subida a Supabase (1 a 1) =====
async function uploadOne(id) {
  if (state.onlyWifi && !connectionOK(true)) {
    alert('Esperando Wi-Fi (desactiva “Solo Wi-Fi” para subir con datos).');
    return;
  }
  const all = await idbAll('local_tracks');
  const it = all.find(x => x.id === id);
  if (!it) return;

  try {
    // 1) subir al bucket 'audios'
    const me = username() || 'anon';
    const path = `${me}/${Date.now()}_${it.name}`;
    const up = await supabase.storage.from('audios').upload(path, it.blob, { contentType: it.type });
    if (up.error) throw up.error;

    // 2) URL pública
    const { data: pub } = supabase.storage.from('audios').getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    // 3) insertar en tabla music (si tu tabla usa 'usuario', lo enviamos)
    await supabase.from('music').insert({
      url: publicUrl,
      title: it.title,
      artist: it.artist,
      usuario: username() || null
    });

    // 4) borrar del local y refrescar
    await idbDel('local_tracks', id);
    renderLocal();
    // refrescar la lista remota (si tu reproductor.js expone esto)
    window.musicRefresh?.();

  } catch (err) {
    console.error('Upload error', err);
    alert('No se pudo subir este archivo. Lo dejamos local.');
  }
}

async function uploadAll() {
  if (state.uploading) return;
  state.uploading = true;

  const items = await idbAll('local_tracks');
  for (const it of items) {
    if (!state.uploading) break;
    await uploadOne(it.id);
    await new Promise(r => setTimeout(r, 1200)); // respirito entre archivos
  }
  state.uploading = false;
}

// ===== Init =====
(async function init() {
  db = await openDB();
  injectUI();
  renderLocal();
})();
