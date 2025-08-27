// Gestor de actividades (solo pinta si existe #listado)
// Requiere supabaseClient.js
import { supabase as _sb } from './supabaseClient.js';
const supabase = _sb || window.supabase;

// ───────── helpers ─────────
const qs  = (s, el = document) => el.querySelector(s);
const byId = (id) => document.getElementById(id);
const on  = (id, ev, fn) => { const n = byId(id); if (n) n.addEventListener(ev, fn); };
const ready = (fn) => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); };
const escapeHtml = (s) => (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// ───────── refs ─────────
const listado = byId('listado'); // si no existe, este script no hace nada

// Si quitaste filtros del HTML, estos serán null (no pasa nada).
const filtros = {
  q: byId('f-q'),
  tipo: byId('f-tipo'),
  estado: byId('f-estado'),
  desde: byId('f-desde'),
  hasta: byId('f-hasta'),
  aplicar: byId('f-aplicar'),
};

let cache = []; // actividades tras aplicar filtros

// ───────── util ─────────
const hhmm = (v) => (!v ? '' : String(v).slice(0,5));
const estadoTxt = (v) => (v===true || v===1 || String(v).toLowerCase()==='true' || String(v)==='1') ? 'completado' : 'pendiente';
const uniqById = (rows) => { const s=new Set(), out=[]; for (const r of rows){ if(!s.has(r.id)){ s.add(r.id); out.push(r); } } return out; };

// ───────── data fetch (propias + grupo + compartidas) ─────────
async function fetchAllFromSupabase() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const uid = user.id;

  // Grupos del usuario
  const { data: memb } = await supabase.from('miembros_grupo').select('grupo_id').eq('usuario_id', uid);
  const misGrupos = (memb || []).map(r => r.grupo_id);

  // IDs compartidas conmigo por tipo
  const { data: comps } = await supabase
    .from('actividades_compartidas')
    .select('tipo, actividad_id')
    .eq('usuario_id', uid);

  const idsCompartidos = { cita: new Set(), tarea: new Set(), rutina: new Set() };
  (comps || []).forEach(r => idsCompartidos[r.tipo]?.add(r.actividad_id));

  // RUTINAS
  const [rOwn, rGrp, rInd] = await Promise.all([
    supabase.from('routines')
      .select('id, description, date, start_time, end_time, is_completed, usuario, grupo_id')
      .eq('usuario', uid),
    misGrupos.length
      ? supabase.from('routines')
          .select('id, description, date, start_time, end_time, is_completed, usuario, grupo_id')
          .in('grupo_id', misGrupos)
      : Promise.resolve({ data: [] }),
    idsCompartidos.rutina.size
      ? supabase.from('routines')
          .select('id, description, date, start_time, end_time, is_completed, usuario, grupo_id')
          .in('id', [...idsCompartidos.rutina])
      : Promise.resolve({ data: [] }),
  ]);

  const rutinas = uniqById([...(rOwn.data||[]), ...(rGrp.data||[]), ...(rInd.data||[])]).map(r => ({
    id: r.id, tipo:'rutina', descripcion:r.description, fecha:r.date||null,
    hora_inicio: hhmm(r.start_time), hora_fin: hhmm(r.end_time), estado: estadoTxt(r.is_completed),
    usuario: r.usuario||null, grupo_id: r.grupo_id||null
  }));

  // TAREAS
  const [tOwn, tGrp, tInd] = await Promise.all([
    supabase.from('tasks')
      .select('id, description, due_date, start_time, end_time, is_completed, usuario, grupo_id')
      .eq('usuario', uid),
    misGrupos.length
      ? supabase.from('tasks')
          .select('id, description, due_date, start_time, end_time, is_completed, usuario, grupo_id')
          .in('grupo_id', misGrupos)
      : Promise.resolve({ data: [] }),
    idsCompartidos.tarea.size
      ? supabase.from('tasks')
          .select('id, description, due_date, start_time, end_time, is_completed, usuario, grupo_id')
          .in('id', [...idsCompartidos.tarea])
      : Promise.resolve({ data: [] }),
  ]);

  const tareas = uniqById([...(tOwn.data||[]), ...(tGrp.data||[]), ...(tInd.data||[])]).map(t => ({
    id: t.id, tipo:'tarea', descripcion:t.description, fecha:t.due_date||null,
    hora_inicio: hhmm(t.start_time), hora_fin: hhmm(t.end_time), estado: estadoTxt(t.is_completed),
    usuario: t.usuario||null, grupo_id: t.grupo_id||null
  }));

  // CITAS
  const [aOwn, aGrp, aInd] = await Promise.all([
    supabase.from('appointments')
      .select('id, description, date, start_time, end_time, completed, usuario, grupo_id')
      .eq('usuario', uid),
    misGrupos.length
      ? supabase.from('appointments')
          .select('id, description, date, start_time, end_time, completed, usuario, grupo_id')
          .in('grupo_id', misGrupos)
      : Promise.resolve({ data: [] }),
    idsCompartidos.cita.size
      ? supabase.from('appointments')
          .select('id, description, date, start_time, end_time, completed, usuario, grupo_id')
          .in('id', [...idsCompartidos.cita])
      : Promise.resolve({ data: [] }),
  ]);

  const citas = uniqById([...(aOwn.data||[]), ...(aGrp.data||[]), ...(aInd.data||[])]).map(a => ({
    id: a.id, tipo:'cita', descripcion:a.description, fecha:a.date||null,
    hora_inicio: hhmm(a.start_time), hora_fin: hhmm(a.end_time), estado: estadoTxt(a.completed),
    usuario: a.usuario||null, grupo_id: a.grupo_id||null
  }));

  return [...rutinas, ...tareas, ...citas];
}

// ───────── filtros en cliente ─────────
function applyFilters(rows){
  const q      = (filtros.q?.value ?? '').trim().toLowerCase();
  const tipo   = filtros.tipo?.value ?? '';
  const estado = filtros.estado?.value ?? '';
  const desde  = filtros.desde?.value ?? '';
  const hasta  = filtros.hasta?.value ?? '';

  return rows.filter(it => {
    if (q && !(it.descripcion || '').toLowerCase().includes(q)) return false;
    if (tipo && it.tipo !== tipo) return false;
    if (estado && it.estado !== estado) return false;
    if (desde && it.fecha && it.fecha < desde) return false;
    if (hasta && it.fecha && it.fecha > hasta) return false;
    return true;
  });
}

// ───────── render ─────────
function groupByFecha(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.fecha || 'Sin fecha';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const keys = [...map.keys()].sort((a,b) => {
    if (a === 'Sin fecha') return 1;
    if (b === 'Sin fecha') return -1;
    return a.localeCompare(b); // asc
  });
  return keys.map(k => ({ fecha:k, items: map.get(k) }));
}

function render(rows){
  if (!listado) return;
  const grupos = groupByFecha(rows);
  listado.innerHTML = '';
  if (!grupos.length){
    listado.innerHTML = `<div class="admin-card"><em>No hay actividades.</em></div>`;
    return;
  }
  for (const g of grupos) {
    const wrap = document.createElement('section');
    wrap.className = 'fecha-grupo';
    wrap.innerHTML = `<h3>${g.fecha}</h3>`;
    for (const a of g.items) {
      const div = document.createElement('div');
      div.className = 'actividad-row';
      div.innerHTML = `
        <div>
          <div class="chip ${a.tipo}">${a.tipo}</div>
          <div><small>${a.hora_inicio && a.hora_fin ? `${a.hora_inicio}–${a.hora_fin}` : (a.hora_inicio || a.hora_fin || '')}</small></div>
        </div>
        <div>
          <div>${escapeHtml(a.descripcion || '(sin descripción)')}</div>
          <div><small>estado: ${a.estado}</small></div>
        </div>
        <div class="row-actions">
          <button class="icon" title="Editar" data-act="edit"><i class="fas fa-pen"></i></button>
          <button class="icon" title="Borrar" data-act="del"><i class="fas fa-trash"></i></button>
          <button class="icon" title="Compartir" data-act="share"><i class="fas fa-share-nodes"></i></button>
        </div>
      `;
      div.querySelector('[data-act="edit"]').onclick  = () => onEdit(a);
      div.querySelector('[data-act="del"]').onclick   = () => onDelete(a);
      div.querySelector('[data-act="share"]').onclick = () => onShare(a);
      wrap.appendChild(div);
    }
    listado.appendChild(wrap);
  }
}

// ───────── acciones ─────────
function onEdit(a){ window.location.href = `/citas?edit=${a.id}`; }
async function onDelete(a){ alert('Borrado pendiente de implementar por tabla concreta.'); }
async function onShare(a){
  // Si no existe el diálogo, no petamos
  const dlg = byId('dlg-compartir');
  if (!dlg?.showModal) { alert('Compartir no disponible en esta vista.'); return; }

  byId('dlg-titulo').textContent = a.descripcion || '(sin descripción)';
  byId('dlg-miembros').innerHTML = `<div class="admin-card">Cargando opciones…</div>`;
  dlg.showModal();

  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) { byId('dlg-miembros').innerHTML = '<em>No hay usuario autenticado</em>'; return; }
  const uid = user.id;

  // mis grupos
  const { data: gIds } = await supabase.from('miembros_grupo').select('grupo_id').eq('usuario_id', uid);
  const gruposIds = (gIds || []).map(r => r.grupo_id);
  let grupos = [];
  if (gruposIds.length){
    const { data: gRows } = await supabase.from('grupos').select('id, nombre').in('id', gruposIds);
    grupos = gRows || [];
  }

  // personas de esos grupos
  let personas = [];
  if (gruposIds.length){
    const { data: mRows } = await supabase.from('miembros_grupo').select('usuario_id, grupo_id').in('grupo_id', gruposIds);
    const uniqUserIds = [...new Set((mRows||[]).map(x=>x.usuario_id))];
    if (uniqUserIds.length){
      const { data: uRows } = await supabase.from('usuarios').select('id, username, email').in('id', uniqUserIds);
      const by = Object.fromEntries((uRows||[]).map(u=>[u.id, u]));
      personas = (mRows||[]).map(x=>({
        usuario_id: x.usuario_id,
        grupo_id: x.grupo_id,
        username: by[x.usuario_id]?.username || by[x.usuario_id]?.email || x.usuario_id
      })).filter(p => p.usuario_id !== uid);
    }
  }

  const personasHtml = personas.map(p=>`
    <label class="chk">
      <input type="checkbox" name="user" value="${p.usuario_id}">
      ${p.username}
    </label>
  `).join('') || `<em>No hay personas en tus grupos.</em>`;

  const gruposHtml = grupos.map(g=>`
    <label class="chk">
      <input type="radio" name="grupo" value="${g.id}">
      ${g.nombre}
    </label>
  `).join('') || `<em>No perteneces a ningún grupo.</em>`;

  byId('dlg-miembros').innerHTML = `
    <div class="share-block">
      <h4>Compartir con grupo</h4>
      ${gruposHtml}
      <small>(asigna la actividad al grupo seleccionado)</small>
    </div>
    <hr>
    <div class="share-block">
      <h4>Compartir con personas</h4>
      ${personasHtml}
      <small>(añade permisos individuales)</small>
    </div>
  `;

  byId('btn-guardar-compartir').onclick = async (e) => {
    e.preventDefault();

    const tabla = (a.tipo === 'cita' ? 'appointments' : a.tipo === 'tarea' ? 'tasks' : 'routines');
    const gSel = qs('#dlg-miembros input[name="grupo"]:checked');
    const uSel = [...document.querySelectorAll('#dlg-miembros input[name="user"]:checked')].map(el=>el.value);

    if (gSel){
      await supabase.from(tabla).update({ grupo_id: gSel.value }).eq('id', a.id);
    }

    await supabase.from('actividades_compartidas').delete().eq('actividad_id', a.id).eq('tipo', a.tipo);
    if (uSel.length){
      const rows = uSel.map(uidSel => ({ tipo: a.tipo, actividad_id: a.id, usuario_id: uidSel }));
      await supabase.from('actividades_compartidas').insert(rows);
    }

    dlg.close('ok');
    await load();
  };
};

// ───────── flujo ─────────
async function load(){
  if (!listado) return;
  listado.innerHTML = `<div class="admin-card"><em>Cargando…</em></div>`;
  const all = await fetchAllFromSupabase();
  cache = applyFilters(all);
  render(cache);
}

async function init(){
  if (!listado || !supabase) return;
  // listeners seguros (si no existen, no pasa nada)
  on('f-aplicar', 'click', load);
  filtros.q?.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  await load();
}

ready(() => { if (listado) init(); });
