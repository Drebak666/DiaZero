// Últimas citas (propias + de grupo + compartidas) con "Mostrar 5 más"
import { supabase as _sb } from './supabaseClient.js';
const supabase = _sb || window.supabase;

const cont = document.getElementById('ultimas-citas');
const STEP = 5;                 // cuántas más mostrar cada click
const BTN_ID = 'btn-mostrar-mas';
const BTN_COLLAPSE = 'btn-plegar';

const mesesES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];


function fmtFecha(iso){
  if (!iso) return 'Sin fecha';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    const d = parseInt(m[3],10);
    const mes = mesesES[parseInt(m[2],10)-1];
    return `${d} de ${mes}`;
  }
  // Fallback por si llega otro formato
  const dt = new Date(iso);
  if (!isNaN(dt)) return `${dt.getDate()} de ${mesesES[dt.getMonth()]}`;
  return iso;
}

// ← PÉGALO aquí, tras esc()
function uniqueDates(rows){
  return [...new Set(rows.map(c => c.date || 'sin-fecha'))];
}
function pickDays(rows, dayCount){
  const days = uniqueDates(rows).slice(0, dayCount);
  return rows.filter(c => days.includes(c.date || 'sin-fecha'));
}


// --- Registro toggle (usa archivo_url = "cita:<id>" para enlazar) ---
let regSet = new Set(); // ids de citas ya registradas
let CURRENT_UID = null;


async function refreshRegistrosFor(appointmentIds){
  const { data:{ user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid || !appointmentIds?.length) { regSet = new Set(); return; }

  const keys = appointmentIds.map(id => `cita:${id}`);
  const { data, error } = await supabase
    .from('registros')
    .select('archivo_url')
    .eq('owner_id', uid)
    .in('archivo_url', keys);

  if (error) { console.warn('No se pudieron leer registros:', error); regSet = new Set(); return; }
  regSet = new Set((data||[])
    .map(r => (r.archivo_url||'').startsWith('cita:') ? r.archivo_url.slice(5) : null)
    .filter(Boolean));
}

async function toggleRegistro(cita){
  const { data:{ user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return false;

  const key = `cita:${cita.id}`;
  const esta = regSet.has(cita.id);

  if (esta){
    const { error } = await supabase
      .from('registros')
      .delete()
      .eq('owner_id', uid)
      .eq('tipo', 'cita')
      .eq('archivo_url', key);
    if (error){ alert('No se pudo quitar del registro'); console.error(error); return true; }
    regSet.delete(cita.id);
    return false; // ahora OFF
  } else {
    const row = {
      nombre: 'cita',
      descripcion: `registro cita: ${cita.description || ''}`,
      fecha: cita.date || null,
      tipo: 'cita',
      archivo_url: key,
      owner_id: uid
    };
    const { error } = await supabase.from('registros').insert(row);
    if (error){ alert('No se pudo registrar'); console.error(error); return false; }
    regSet.add(cita.id);
    return true; // ahora ON
  }
}

async function registrarAccion(accion, cita){
  // inserta en public.registros
  const { data:{ user } } = await supabase.auth.getUser();
  const uid = user?.id || null;
  const row = {
    nombre: 'cita',
    descripcion: `${accion}: ${cita.description || ''}`,
    fecha: cita.date || null,
    tipo: 'cita',
    archivo_url: '',      // si no tienes archivo, lo dejamos vacío
    owner_id: uid      // tu columna es TEXT; si fuera uuid usa uid sin ::text
  };
  const { error } = await supabase.from('registros').insert(row);
  if (error) console.warn('No se pudo registrar la acción:', error);
}


function isFinished(c){
  // terminado cuando ahora >= fin (o, si no hay fin, >= inicio)
  const end = c.end_time ? parseLocal(c.date, c.end_time)
                         : parseLocal(c.date, c.start_time);
  if (!end) return false;
  return Date.now() >= end.getTime();
}

async function autoCompleteFinished(rows){
  // marca como completadas en BD las que ya terminaron
  const ids = rows.filter(c => !c.completed && isFinished(c)).map(c => c.id);
  if (!ids.length) return;
  const { error } = await supabase
    .from('appointments')
    .update({ completed: true })
    .in('id', ids);
  if (error) console.warn('Autocompletar falló (RLS en compartidas es normal):', error);
  // refleja en memoria para reordenar sin refetch
  rows.forEach(c => { if (ids.includes(c.id)) c.completed = true; });
}

function parseLocal(dateStr, timeStr){
  if (!dateStr) return null;
  const [y,m,d] = dateStr.split('-').map(n => parseInt(n,10));
  let hh = 0, mm = 0;
  if (timeStr && /^\d{2}:\d{2}/.test(timeStr)) {
    [hh, mm] = timeStr.split(':').map(n => parseInt(n,10));
  }
  return new Date(y, m-1, d, hh, mm, 0, 0);
}

function diffStr(ms){
  if (ms < 0) ms = 0;
  const day = 86_400_000;
  if (ms >= day){
    const d = Math.ceil(ms / day);
    return `${d} día${d>1?'s':''}`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/* Falta X si aún no empieza; Quedan X si ya empezó; Finalizada si terminó */
function tiempoRestante(fecha, ini, fin){
  const now = new Date();
  const start = parseLocal(fecha, ini || '00:00');
  if (!start) return '—';
  let end = fin ? parseLocal(fecha, fin) : null;
  if (end && end < start) end = start; // sanea

  if (now < start)            return `Falta ${diffStr(start - now)}`;
  if (end && now <= end)      return `Quedan ${diffStr(end - now)}`;
  if (!end && now <= start)   return `Falta ${diffStr(start - now)}`;
  return 'Finalizada';
}



let cache = [];                 // todas las próximas, ordenadas
let visible = 1;                // cuántas se muestran ahora

// ───────── util ─────────
const ready = (fn) => (document.readyState === 'loading')
  ? document.addEventListener('DOMContentLoaded', fn)
  : fn();

const hhmm = v => (!v ? '' : String(v).slice(0,5));
const hoyISO = () => {
  const d = new Date(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${m}-${day}`;
};
const uniqById = rows => { const m=new Map(); rows.forEach(r=>m.set(r.id,r)); return [...m.values()]; };
const esc = s => (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// ───────── data ─────────
async function fetchUltimasCitas() {
  if (!cont) return [];

  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  CURRENT_UID = uid; // ← guarda el uid para usar en render

  if (!uid) { cont.innerHTML = '<em>No autenticado.</em>'; return []; }

  // Mis grupos  (✅ ahora por usuario_id)
  const { data: memb } = await supabase
    .from('miembros_grupo')
    .select('grupo_id')
    .eq('usuario_id', uid);
  const misGrupos = (memb || []).map(r => r.grupo_id);

  // IDs compartidas conmigo
  const { data: compLinks } = await supabase
    .from('actividades_compartidas')
    .select('actividad_id')
    .eq('usuario_id', uid)
    .eq('tipo', 'cita');
  const idsCompartidas = (compLinks || []).map(r => r.actividad_id);

  // Citas de 3 vías
  const [propiasRes, grupoRes, compRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, description, date, start_time, end_time, completed, owner_id, grupo_id, requirements')
      .eq('owner_id', uid),

    misGrupos.length
      ? supabase
          .from('appointments')
          .select('id, description, date, start_time, end_time, completed, owner_id, grupo_id, requirements')
          .in('grupo_id', misGrupos)
      : Promise.resolve({ data: [] }),

    idsCompartidas.length
      ? supabase
          .from('appointments')
          .select('id, description, date, start_time, end_time, completed, owner_id, grupo_id, requirements')
          .in('id', idsCompartidas)
      : Promise.resolve({ data: [] }),
  ]);

  // Unir TODO y dejar solo próximas (desde hoy), ordenadas por fecha+hora
  const all = uniqById([...(propiasRes.data||[]), ...(grupoRes.data||[]), ...(compRes.data||[])]);
  const hoy = hoyISO();
  return all
    .filter(a => !a.date || a.date >= hoy)
    .sort((a,b) =>
      String(a.date||'9999-12-31').localeCompare(String(b.date||'9999-12-31')) ||
      String(a.start_time||'').localeCompare(String(b.start_time||'')));
}


// ======== Compartir: estado y utilidades ========
let shareSet = new Set();                // citas que tienen grupo o personas compartidas
let shareUsersMap = new Map();           // citaId -> Set(usuario_id)

// Carga estado de compartidos para las citas que se van a mostrar
async function refreshShares(appointments){
  const ids = appointments.map(c => c.id);
  shareSet = new Set();
  shareUsersMap = new Map();
  if (!ids.length) return;

  // Personas (actividades_compartidas)
  const { data: rows, error } = await supabase
    .from('actividades_compartidas')
    .select('actividad_id, usuario_id')
    .eq('tipo', 'cita')
    .in('actividad_id', ids);
  if (!error && rows) {
    rows.forEach(r => {
      shareSet.add(r.actividad_id);
      if (!shareUsersMap.has(r.actividad_id)) shareUsersMap.set(r.actividad_id, new Set());
      shareUsersMap.get(r.actividad_id).add(r.usuario_id);
    });
  }

  // Grupo (viene en appointments.grupo_id)
  appointments.forEach(c => { if (c.grupo_id) shareSet.add(c.id); });
}

// Abre modal y guarda cambios
async function openShareModal(c){
  const modal = document.getElementById('modal-compartir');
  const form = document.getElementById('form-compartir');
  const idInput = document.getElementById('share-id');
  const selGrupo = document.getElementById('share-grupo');
  const boxPersonas = document.getElementById('share-personas');
  const btnCancel = document.getElementById('share-cancel');
  const btnClear = document.getElementById('share-clear');
  if (!modal) return;

  idInput.value = c.id;

  // Grupos del usuario actual (✅ ahora por usuario_id)
  const { data:{ user } } = await supabase.auth.getUser();
  const uid = user?.id;
  const { data: memb } = await supabase.from('miembros_grupo')
    .select('grupo_id')
    .eq('usuario_id', uid);
  const gIds = (memb||[]).map(r => r.grupo_id);
  let grupos = [];
  if (gIds.length){
    const { data: g } = await supabase.from('grupos').select('id, nombre').in('id', gIds);
    grupos = g || [];
  }
  selGrupo.innerHTML = `<option value="">— Ninguno —</option>` +
    grupos.map(g => `<option value="${g.id}">${(g.nombre||'Grupo')}</option>`).join('');
  selGrupo.value = c.grupo_id || '';

  // Personas (usuarios), exceptuando al propio
  const { data: users } = await supabase.from('usuarios').select('id, username');
  const ya = shareUsersMap.get(c.id) || new Set();
  boxPersonas.innerHTML = (users||[])
    .filter(u => u.id !== uid)
    .map(u => `<label><input type="checkbox" value="${u.id}" ${ya.has(u.id)?'checked':''}> ${u.username||''}</label>`)
    .join('');

  // Abrir
  modal.classList.remove('oculto');

  // Quitar todo (grupo + personas)
  const clearHandler = async () => {
    try {
      if (c.grupo_id) {
        await supabase.from('appointments').update({ grupo_id: null }).eq('id', c.id);
        c.grupo_id = null; selGrupo.value = '';
      }
      const prev = [...(shareUsersMap.get(c.id) || new Set())];
      if (prev.length){
        await supabase.from('actividades_compartidas')
          .delete().eq('tipo','cita').eq('actividad_id', c.id).in('usuario_id', prev);
      }
      shareUsersMap.set(c.id, new Set());
      boxPersonas.querySelectorAll('input[type="checkbox"]').forEach(i => i.checked = false);
    } catch(e){ console.error(e); alert('No se pudo quitar todo'); }
  };

  const submitHandler = async (e) => {
    e.preventDefault();
    try {
      // Grupo
      const newGrupo = selGrupo.value || null;
      if ((c.grupo_id||null) !== newGrupo){
        const { error } = await supabase.from('appointments').update({ grupo_id: newGrupo }).eq('id', c.id);
        if (error) throw error;
        c.grupo_id = newGrupo;
      }
      // Personas
      const chosen = new Set([...boxPersonas.querySelectorAll('input[type="checkbox"]:checked')].map(i => i.value));
      const prev = new Set(shareUsersMap.get(c.id) || []);
      const toAdd = [...chosen].filter(x => !prev.has(x));
      const toDel = [...prev].filter(x => !chosen.has(x));
      if (toAdd.length){
        const rows = toAdd.map(uid2 => ({ actividad_id: c.id, usuario_id: uid2, tipo:'cita' }));
        const { error } = await supabase.from('actividades_compartidas').insert(rows);
        if (error) throw error;
      }
      if (toDel.length){
        const { error } = await supabase.from('actividades_compartidas')
          .delete().eq('tipo','cita').eq('actividad_id', c.id).in('usuario_id', toDel);
        if (error) throw error;
      }
      shareUsersMap.set(c.id, chosen);
      // Estado del botón
      const on = !!(c.grupo_id || chosen.size);
      if (on) shareSet.add(c.id); else shareSet.delete(c.id);
      const btn = document.querySelector(`.btn-share[data-id="${c.id}"]`);
      if (btn){
        btn.classList.toggle('on', on);
        const icon = btn.querySelector('i');
        if (icon){
          icon.classList.remove('fa-share-nodes','fa-check');
          icon.classList.add(on ? 'fa-check' : 'fa-share-nodes');
        }
      }
      modal.classList.add('oculto');
    } catch(e){ console.error(e); alert('No se pudo guardar'); }
  };

  const cancelHandler = () => { modal.classList.add('oculto'); };

  btnClear.addEventListener('click', clearHandler, { once:false });
  form.addEventListener('submit', submitHandler, { once:true });
  document.getElementById('share-cancel')?.addEventListener('click', cancelHandler, { once:true });
}

// ───────── render ─────────
function renderPartial() {
  if (!cont) return;

  if (!cache.length) {
    cont.innerHTML = '<em>No hay citas próximas.</em>';
    return;
  }

const toShow = pickDays(cache, visible);


  const htmlLista = toShow.map(c => {
    const shared = shareSet.has(c.id);
const isLogged = regSet.has(c.id);

const hora = c.start_time && c.end_time
  ? `${hhmm(c.start_time)}–${hhmm(c.end_time)}`
  : (hhmm(c.start_time) || hhmm(c.end_time) || '');
const rest = tiempoRestante(c.date, c.start_time, c.end_time);

// ← Mueve readonly AQUÍ (antes de reqHtml)
const owner = c.owner_id;
const readonly = !!(CURRENT_UID && owner !== CURRENT_UID);


// requisitos
const reqs = Array.isArray(c.requirements) ? c.requirements : [];
const reqHtml = reqs.length
  ? `<details class="req"><summary>Requisitos (${reqs.length})</summary>
      ${reqs.map((r,i) => `
        <label class="req-item">
          <input type="checkbox" class="req-toggle"
       data-id="${c.id}" data-idx="${i}"
       ${r.checked ? 'checked' : ''} ${readonly ? 'disabled' : ''}>
          ${esc(r.text || '')}
        </label>`).join('')}
     </details>`
  : '';

const finalizada = isFinished(c) ? 'finalizada' : '';

const actionsHtml = readonly ? '' : `
  <div class="cita-actions">
    <button type="button" class="icon-button edit btn-edit" data-id="${c.id}">
      <i class="fas fa-pen"></i>
    </button>
    <button type="button" class="icon-button share btn-share ${shared ? 'on' : ''}" 
            data-id="${c.id}" title="${shared ? 'Compartido' : 'Compartir'}">
      <i class="fas ${shared ? 'fa-check' : 'fa-share-nodes'}"></i>
    </button>
    <button type="button" class="icon-button delete btn-delete" data-id="${c.id}">
      <i class="fas fa-trash"></i>
    </button>
    <button type="button" class="icon-button log btn-log ${isLogged ? 'on' : ''}" data-id="${c.id}">
      <i class="fas ${isLogged ? 'fa-check' : 'fa-bookmark'}"></i>
    </button>
  </div>
`;


return `
  <div class="cita-card ${finalizada} ${readonly ? 'solo-lectura' : ''}" data-id="${c.id}">
    <div class="cita-header">
      <span class="cita-titulo">${esc(c.description||'Sin descripción')}</span>
      <span class="cita-fecha">${fmtFecha(c.date)}</span>
    </div>

    <div class="cita-horas">${hora}</div>
    <div class="cita-restante">${rest}</div>

    ${reqHtml ? `<div class="cita-requisitos">${reqHtml}</div>` : ''}

    ${actionsHtml}
  </div>
`;






  }).join('');

const totalDays = uniqueDates(cache).length;
const quedan = Math.max(0, totalDays - visible);
const showPlegar = visible > 1;
const htmlAcciones = (quedan > 0 || showPlegar)
  ? `<div class="mas-wrap">
       ${quedan > 0 ? `<button id="${BTN_ID}" class="btn-more">Mostrar 1 día más</button>` : ''}
       ${showPlegar ? `<button id="${BTN_COLLAPSE}" class="btn-less">Plegar</button>` : ''}
     </div>`
  : '';


  cont.innerHTML = htmlLista + htmlAcciones;

  // Botón "Mostrar más" / "Plegar"
  if (quedan > 0) document.getElementById(BTN_ID)?.addEventListener('click', () => {
  const totalDays = uniqueDates(cache).length;
  visible = Math.min(totalDays, visible + 1);   // añade 1 DÍA
  renderPartial();
});

  if (showPlegar) document.getElementById(BTN_COLLAPSE)?.addEventListener('click', () => {
    visible = 1; renderPartial(); cont.scrollIntoView({ behavior:'smooth', block:'start' });
  });

  // Guardar checks de requisitos
 // Guardar checks de requisitos
cont.querySelectorAll('.req-toggle').forEach(inp => {
  if (inp.disabled) return;         // ← evita listeners en modo vista
inp.addEventListener('change', async () => {
    const id  = inp.dataset.id;
    const idx = parseInt(inp.dataset.idx, 10);
    const item = cache.find(x => x.id === id);
    if (!item || !Array.isArray(item.requirements)) return;

    // 1) Actualiza el array de requisitos en la cita
    const next = item.requirements.map((r,i) => i === idx ? { ...r, checked: inp.checked } : r);
    item.requirements = next;
    const { error: errAppt } = await supabase.from('appointments').update({ requirements: next }).eq('id', id);
    if (errAppt) console.warn('No se pudo guardar el requisito:', errAppt);

    // 2) Sincroniza/crea la tarea correspondiente (idempotente)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id || null;
      const hoyStr = new Date().toISOString().slice(0,10);
      const req = next[idx];

      await supabase
  .from('tasks')
  .upsert([{
    owner_id: uid, // ✅ antes: usuario: uid
    description: `[Cita] ${item.description || ''} — ${req.text || ''}`,
    due_date: hoyStr,
    is_completed: !!req.checked,
    appointment_id: id,
    grupo_id: item.grupo_id || null,
    requirement_index: idx
  }], { onConflict: 'appointment_id,requirement_index' });

    } catch(e){
      console.warn('No se pudo sincronizar la tarea del requisito', e);
    }

    // 3) Refresca Agenda hoy si existe esa función
    window.cargarAgendaHoy?.();
  });
});


  // === Acciones ===
// Editar → abrir modal (SIN registrar en "registros")
cont.querySelectorAll('.btn-edit').forEach(btn => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const cita = cache.find(x => x.id === id);
    if (!cita) return;
    // await registrarAccion('editar (modal)', cita); // ← QUITADO
    abrirModalCita(cita);
  });
});

// Compartir → abre modal
cont.querySelectorAll('.btn-share').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    const cita = cache.find(x => x.id === id);
    if (!cita) return;
    openShareModal(cita);   // abre el modal de compartir
  });
});


  // Borrar → borra la cita y registramos
  cont.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const cita = cache.find(x => x.id === id);
      if (!cita) return;
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (error) { alert('No se pudo borrar'); console.error(error); return; }
      await registrarAccion('borrar', cita);   // opcional: comenta si no te interesa el log
      await refreshUltimas();                   // recargar lista
    });
  });

// Registro → toggle ON/OFF
cont.querySelectorAll('.btn-log').forEach(btn => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const cita = cache.find(x => x.id === id);
    if (!cita) return;

    const on = await toggleRegistro(cita);

    // Actualiza UI del botón
    btn.classList.toggle('on', on);
    const icon = btn.querySelector('i');
    if (icon){
      icon.classList.remove('fa-bookmark', 'fa-check');
      icon.classList.add(on ? 'fa-check' : 'fa-bookmark');
    }
  });
});

}


// ───────── refresh + auto + realtime ─────────
async function refreshUltimas() {
  try {
    let rows = await fetchUltimasCitas();

    // Autocompletar las que ya terminaron (y marcar en local)
    await autoCompleteFinished(rows);

    // Reordenar: activas primero, finalizadas al final
    const sortFn = (a,b) =>
      String(a.date||'9999-12-31').localeCompare(String(b.date||'9999-12-31')) ||
      String(a.start_time||'').localeCompare(String(b.start_time||''));

    const activos     = rows.filter(c => !isFinished(c)).sort(sortFn);
    const finalizadas = rows.filter(c =>  isFinished(c)).sort(sortFn);

    cache = [...activos, ...finalizadas];
    await refreshShares(cache);   // ← carga estado de compartidos

        await refreshRegistrosFor(cache.map(c => c.id)); // ← estado de registrados (toggle)


    
    // mostrar solo la más próxima tras cada refresh
    visible = Math.min(1, cache.length);
    renderPartial();
  } catch (e) {
    console.error(e);
    if (cont) cont.innerHTML = '<em>Error cargando citas.</em>';
  }
}


const INTERVALO_MS = 60_000; // 60s
let timer;
function startAutoRefresh() {
  clearInterval(timer);
  timer = setInterval(refreshUltimas, INTERVALO_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(timer);
  else startAutoRefresh();
});

// Realtime (suscripción única)
let rtCh = null;
function startRealtime() {
  if (rtCh) return;
  const handle = () => refreshUltimas();

  rtCh = supabase.channel('ultimas-citas')
    // Refrescar cuando cambian citas o sus compartidos
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'actividades_compartidas' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'miembros_grupo' }, handle)

    // Sincronía requisitos <-> tasks (UPDATE)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, async (payload) => {
      const t = payload.new;
      if (!t || !t.appointment_id || t.requirement_index == null) return;

      const cita = cache.find(x => x.id === t.appointment_id);
      if (!cita || !Array.isArray(cita.requirements)) return;

      const idx = Number(t.requirement_index);
      if (idx < 0 || idx >= cita.requirements.length) return;

      const cur = !!(cita.requirements[idx]?.checked);
      if (cur === !!t.is_completed) return;

      const next = cita.requirements.map((r,i) =>
        i === idx ? { ...r, checked: !!t.is_completed } : r
      );
      cita.requirements = next;
      await supabase.from('appointments').update({ requirements: next }).eq('id', cita.id);
      renderPartial();
    })

    // Sincronía requisitos <-> tasks (DELETE)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, async (payload) => {
      const t = payload.old;
      if (!t || !t.appointment_id || t.requirement_index == null) return;

      const cita = cache.find(x => x.id === t.appointment_id);
      if (!cita || !Array.isArray(cita.requirements)) return;

      const idx = Number(t.requirement_index);
      if (idx < 0 || idx >= cita.requirements.length) return;

      const next = cita.requirements.map((r,i) =>
        i === idx ? { ...r, checked: false } : r
      );
      cita.requirements = next;
      await supabase.from('appointments').update({ requirements: next }).eq('id', cita.id);
      renderPartial();
    })
    .subscribe();

  window.addEventListener('beforeunload', () => supabase.removeChannel(rtCh));
}

window.cargarAgendaHoy?.();


// ───────── boot ─────────
ready(async () => {
  if (!cont) return;
  cont.innerHTML = '<em>Cargando…</em>';
  await refreshUltimas();
  startAutoRefresh();
  startRealtime();
});

// ==== Modal Editar Cita (con requisitos) ====
function getModalEls(){
  const modal = document.getElementById('modal-editar-cita');
  return {
    modal,
    form:      modal?.querySelector('#form-editar-cita'),
    iId:       modal?.querySelector('#edit-cita-id'),
    iDesc:     modal?.querySelector('#edit-cita-desc'),
    iFecha:    modal?.querySelector('#edit-cita-fecha'),
    iInicio:   modal?.querySelector('#edit-cita-inicio'),
    iFin:      modal?.querySelector('#edit-cita-fin'),
    iReqInput: modal?.querySelector('#edit-cita-req-input'),
    reqList:   modal?.querySelector('#edit-cita-req-list'),
    btnAddReq: modal?.querySelector('#btn-add-req'),
    btnClose:  modal?.querySelector('#cerrar-modal-cita'),
  };
}

// estado temporal de requisitos del modal
let _modalReqs = []; // [{ text, checked }]

function pintarReqChips(listEl){
  if (!listEl) return;
  listEl.innerHTML = '';
  _modalReqs.forEach((r, idx) => {
    const div = document.createElement('div');
    div.className = 'req-chip';
    div.innerHTML = `
      <span>${(r.text||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}</span>
      <button type="button" data-idx="${idx}">×</button>
    `;
    div.querySelector('button').addEventListener('click', () => {
      _modalReqs.splice(idx, 1);
      pintarReqChips(listEl);
    });
    listEl.appendChild(div);
  });
}

function abrirModalCita(c){
  const { modal, form, iId, iDesc, iFecha, iInicio, iFin, iReqInput, reqList, btnAddReq, btnClose } = getModalEls();
  if (!modal) return;

  // Rellenar campos
  iId.value      = c.id;
  iDesc.value    = c.description || '';
  iFecha.value   = c.date || '';
  iInicio.value  = (c.start_time || '').slice(0,5);
  iFin.value     = (c.end_time   || '').slice(0,5);
  _modalReqs     = Array.isArray(c.requirements) ? c.requirements.map(r => ({ text: r.text || String(r||''), checked: !!r.checked })) : [];
  pintarReqChips(reqList);
  iReqInput.value = '';

  // listeners (solo una vez por apertura con {once:true})
  btnAddReq?.addEventListener('click', () => {
    const t = (iReqInput.value || '').trim();
    if (!t) return;
    _modalReqs.push({ text: t, checked: false });
    iReqInput.value = '';
    pintarReqChips(reqList);
  });

  btnClose?.addEventListener('click', () => { modal.classList.add('oculto'); }, { once:true });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const row = {
      description: iDesc.value.trim(),
      date: iFecha.value || null,
      start_time: iInicio.value || null,
      end_time: iFin.value || null,
      requirements: _modalReqs
    };
    const { error } = await supabase.from('appointments').update(row).eq('id', iId.value);
    // --- SYNC requisitos -> tasks (upsert y delete de sobrantes) ---
try {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id || null;
  const aid = iId.value;                          // appointment_id
  const hoyStr = new Date().toISOString().slice(0,10);

  // 1) upsert de todas las tareas de los requisitos actuales (_modalReqs)
  const reqs = _modalReqs || [];
  const rows = reqs.map((r, idx) => ({
  owner_id: uid,  // antes: usuario: uid
    description: `[Cita] ${iDesc.value.trim()} — ${r.text || ''}`,
    due_date: hoyStr,
    is_completed: !!r.checked,
    appointment_id: aid,
    grupo_id: (typeof c?.grupo_id !== 'undefined') ? c.grupo_id : null, // si existe en tu esquema
    requirement_index: idx
  }));
  if (rows.length) {
    await supabase.from('tasks').upsert(rows, {
      onConflict: 'appointment_id,requirement_index'
    });
  }

  // 2) borrar tareas cuyos requirement_index ya no existan
  const { data: existentes } = await supabase
    .from('tasks')
    .select('id, requirement_index')
    .eq('appointment_id', aid);

  const vivos = new Set(reqs.map((_, idx) => idx));
  const aBorrarIdx = (existentes || [])
    .map(t => Number(t.requirement_index))
    .filter(idx => !vivos.has(idx));

  if (aBorrarIdx.length) {
    await supabase
      .from('tasks')
      .delete()
      .eq('appointment_id', aid)
      .in('requirement_index', aBorrarIdx);
  }
} catch (e) {
  console.warn('Sync requisitos->tasks al editar falló:', e);
}

    if (error) { alert('No se pudo guardar'); console.error(error); return; }
    modal.classList.add('oculto');
    await refreshUltimas();
  }, { once:true });

  modal.classList.remove('oculto');
}


