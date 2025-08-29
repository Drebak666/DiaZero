// today-agenda.js — Agenda de HOY (tareas + rutinas)
// ahora incluye: propias + de grupo + COMPARTIDAS

import { supabase } from './supabaseClient.js';
import { planificarMejorasHoy } from './mejoras-planner.js';

function limpiarEtiquetasDescripcion(txt) {
  if (!txt) return '';
  return txt.replace(/^\s*\[(?:mejora|cita|tarea|requisito|documento|rutina)\]\s*/i, '');
}


let DND_INIT = false;


const container = document.getElementById('agenda-container');

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(); }
function rutinaTerminadaHoy(rutina) {
  if (!rutina.end_time || !rutina.end_time.includes(':')) return false;
  const ahora = new Date();
  const [h, m] = rutina.end_time.split(':').map(Number);
  const fin = new Date(); fin.setHours(h, m, 0, 0);
  return ahora > fin;
}
function formatHora(hora) { if (!hora || hora === '00:00:00') return ''; return hora.slice(0,5); }
function daysLeft(dateStr){
  if(!dateStr) return null;
  const t=new Date(); t.setHours(0,0,0,0);
  const d=new Date(dateStr); d.setHours(0,0,0,0);
  return Math.round((d - t)/86400000);
}

function minutos(hhmm){ if(!hhmm) return null; const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function rankItem(it, nowMin){
  const st=minutos(it.start_time), en=minutos(it.end_time), done=!!it.is_completed;
  if (done) return 6;                                         // 6) completadas
  if (st!=null && en!=null && st<=nowMin && nowMin<en) return 1; // 1) vigente
  if (st!=null && nowMin<st) return 2;                        // 2) próximas con hora
  if (en!=null && en<=nowMin) return 3;                       // 3) pasadas sin marcar
  if (st==null && en==null) return 4;                         // 4) sin hora
  return 5;                                                   // 5) resto (docs/otros)
}
function cmpAgenda(a,b,nowMin){
  const ra=rankItem(a,nowMin), rb=rankItem(b,nowMin);
  if (ra!==rb) return ra-rb;
  if (ra===1 || ra===2) return (a.start_time||'').localeCompare(b.start_time||''); // por iniciar/en curso
  if (ra===3) return (b.end_time||'').localeCompare(a.end_time||'');              // pasadas: fin DESC
  return 0;
}

const uniqById = (rows) => { const m = new Map(); (rows||[]).forEach(r => m.set(r.id, r)); return [...m.values()]; };

// Filtra "Hoy" solo por due_date (tu tabla no tiene 'date')
const filtroHoy = (qb, hoyStr) => qb.eq('due_date', hoyStr);


async function cargarAgendaHoy() {
  const hoy = new Date();
  const diaSemanaEsp = hoy.toLocaleDateString('es-ES', { weekday: 'long' });
  const hoyStr = hoy.toISOString().split('T')[0];
  let actividades = [];

  // 🔸 Planificar mejoras del día (idempotente por UNIQUE)
  await planificarMejorasHoy({ presupuestoMin: 60, bloquesPermitidos: [25, 15], maxTareas: 4 });

  // 👤 UID del usuario autenticado
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { console.warn('[AGENDA] No hay usuario autenticado'); renderizarActividades([]); return; }
  const uid = user.id;


// --- LIMPIEZA/MOVIMIENTO AUTOMÁTICO ---
// BORRAR completadas anteriores a hoy (solo due_date) + DESMARCAR requisitos vinculados
{
  // 1) Obtener las tasks que se van a borrar
  const { data: toDel, error: eRead } = await supabase
    .from('tasks')
    .select('id, appointment_id, requirement_index')
    .lt('due_date', hoyStr)
    .eq('is_completed', true)
    .eq('owner_id', uid);

  if (!eRead && (toDel?.length)) {
    // 2) Agrupar por cita y recoger los índices de requisitos
    const apptMap = new Map(); // citaId -> Set(idx)
    toDel.forEach(t => {
      if (t.appointment_id && t.requirement_index != null) {
        const idx = Number(t.requirement_index);
        if (!apptMap.has(t.appointment_id)) apptMap.set(t.appointment_id, new Set());
        apptMap.get(t.appointment_id).add(idx);
      }
    });

    // 3) Desmarcar en appointments.requirements los índices afectados
    if (apptMap.size) {
      const apptIds = [...apptMap.keys()];
      const { data: appts } = await supabase
        .from('appointments')
        .select('id, requirements')
        .in('id', apptIds);

      for (const a of (appts || [])) {
        if (!Array.isArray(a.requirements)) continue;
        const idxSet = apptMap.get(a.id) || new Set();
        const nextReqs = a.requirements.map((r, i) =>
          idxSet.has(i) ? { ...(r || {}), checked: false } : r
        );
        await supabase.from('appointments').update({ requirements: nextReqs }).eq('id', a.id);
      }
    }

    // 4) Ahora sí, borrar definitivamente esas tasks
    await supabase
      .from('tasks')
      .delete()
      .in('id', toDel.map(t => t.id));
  } else {
    // Si no hay ninguna que sincronizar, borrar por el criterio original
    await supabase
      .from('tasks')
      .delete()
      .lt('due_date', hoyStr)
      .eq('is_completed', true)
      .eq('owner_id', uid);
  }
}



// MOVER a hoy las NO completadas anteriores a hoy (solo due_date)
await supabase.from('tasks')
  .update({ due_date: hoyStr })
  .lt('due_date', hoyStr)
  .eq('is_completed', false)
  .eq('owner_id', uid)   // <-- antes 'usuario'

  .is('improvement_id', null); // quítalo si quieres mover también las ligadas a improvements




// 🧑‍🤝‍🧑 Mis grupos (para tareas/rutinas de grupo)
const { data: memb } = await supabase
  .from('miembros_grupo')
  .select('grupo_id')
  .eq('usuario_id', uid);

// filtra ids vacíos / malformados (evita 400 en .in())
const misGrupos = (memb || [])
  .map(r => r.grupo_id)
  .filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));

// 🔗 IDs compartidos conmigo
const [{ data: tLinks }, { data: rLinks }] = await Promise.all([
  supabase.from('actividades_compartidas')
    .select('actividad_id')
    .eq('usuario_id', uid)
    .eq('tipo', 'tarea'),
  supabase.from('actividades_compartidas')
    .select('actividad_id')
    .eq('usuario_id', uid)
    .eq('tipo', 'rutina'),
]);

const idsTareasCompartidas  = (tLinks || [])
  .map(x => x.actividad_id)
  .filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));

const idsRutinasCompartidas = (rLinks || [])
  .map(x => x.actividad_id)
  .filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));

// ✅ TAREAS HOY: propias + grupo + compartidas (solo due_date)
const [tOwn, tGrp, tInd] = await Promise.all([
  filtroHoy(supabase.from('tasks').select('*').eq('owner_id', uid), hoyStr),
  misGrupos.length
    ? filtroHoy(supabase.from('tasks').select('*').in('grupo_id', misGrupos), hoyStr)
    : Promise.resolve({ data: [] }),
  idsTareasCompartidas.length
    ? filtroHoy(supabase.from('tasks').select('*').in('id', idsTareasCompartidas), hoyStr)
    : Promise.resolve({ data: [] }),
]);


const tareas = uniqById([
  ...(tOwn?.data ?? []),
  ...(tGrp?.data ?? []),
  ...(tInd?.data ?? []),
]);





  if (tareas.length) {
    // Fechas de caducidad de documentos vinculados
    let docCaducidades = {};
    const docIds = tareas.map(t => t.document_id).filter(Boolean);
    if (docIds.length) {
      const uniques = [...new Set(docIds)];
      const { data: docs } = await supabase.from('documentos').select('id, caduca_el, owner_id').in('id', uniques);
      if (docs) docCaducidades = Object.fromEntries(docs.map(d => [d.id, d.caduca_el]));
    }

    const tareasFormateadas = tareas.map(t => {
      const idxNum = Number.isFinite(Number(t.requirement_index)) ? Number(t.requirement_index) : null;
      const caduca = t.document_id ? docCaducidades[t.document_id] : null;
      const left = caduca ? daysLeft(caduca) : null;

      let descripcion = t.description;
      if (t.document_id && left != null) {
        let tag = null;
        if (left < 0) tag = 'CADUCADO';
        else if (left === 0) tag = 'CADUCA HOY';
        else if (left <= 30) tag = `quedan ${left} días`;
        if (tag) descripcion = `${t.description} (${tag})`;
      }

      return {
        tipo: 'Tarea',
        id: t.id,
        descripcion,
        start: t.start_time || '',
        end: t.end_time || '',
        completado: t.is_completed,
        prioridad: t.priority,
        appointment_id: t.appointment_id ?? null,
        requirement_index: idxNum,
        improvement_id: t.improvement_id ?? null,
        document_id: t.document_id ?? null,
        doc_days_left: left
      };
    });

    actividades = actividades.concat(tareasFormateadas);
  }

  // 🔁 RUTINAS del día: propias + grupo + compartidas (filtradas por día/fechas)
  const [rOwn, rGrp, rInd] = await Promise.all([
supabase.from('routines').select('*').eq('is_active', true).eq('owner_id', uid),
    misGrupos.length
      ? supabase.from('routines').select('*').eq('is_active', true).in('grupo_id', misGrupos)
      : Promise.resolve({ data: [] }),
    idsRutinasCompartidas.length
      ? supabase.from('routines').select('*').eq('is_active', true).in('id', idsRutinasCompartidas)
      : Promise.resolve({ data: [] }),
  ]);
  const rutinasAll = uniqById([...(rOwn.data||[]), ...(rGrp.data||[]), ...(rInd.data||[])]);

  if (rutinasAll.length) {
    const f0 = (d) => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), new Date(d).getDate());
    const fechaHoy = f0(hoy);

    const rutinasDelDia = rutinasAll.filter(r => {
      const cumpleDiaSemana =
        Array.isArray(r.days_of_week) && r.days_of_week.includes(capitalize(diaSemanaEsp));
      const fechaInicio = f0(r.date);
      const fechaFin = r.end_date ? f0(r.end_date) : null;
      return cumpleDiaSemana && fechaInicio <= fechaHoy && (!fechaFin || fechaHoy <= fechaFin);
    });

    const rutinasFormateadas = rutinasDelDia.map(r => ({
      tipo: 'Rutina',
      id: r.id,
      descripcion: r.description,
      start: r.start_time || '',
      end: r.end_time || '',
      completado: rutinaTerminadaHoy(r)
    }));

    actividades = actividades.concat(rutinasFormateadas);
  }

  renderizarActividades(actividades);
}

function renderizarActividades(actividades) {
  container.innerHTML = '';
  if (actividades.length === 0) {
    container.innerHTML = '<p class="no-citas-msg">No hay actividades para hoy.</p>';
    return;
  }

  // ===== ORDEN NUEVO =====
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const MM = (hhmm) => { if (!hhmm) return null; const [h,m]=hhmm.split(':').map(Number); return h*60+m; };
  const esDoc    = (a) => (a.tipo === 'Tarea' && a.document_id != null);
  const conHora  = (a) => !!(a.start && a.start.includes(':') && a.end && a.end.includes(':'));
  const enCurso  = (a) => {
    if (!conHora(a)) return false;
    const st = MM(a.start), en = MM(a.end);
    return st!=null && en!=null && st <= nowMin && nowMin < en;
  };

  const enCursoA = [], proximas = [], pasadas = [], sinHora = [], documentos = [], completadas = [];
  for (const a of actividades) {
    if (a.completado) { completadas.push(a); continue; }
    if (esDoc(a))     { documentos.push(a);  continue; }
    if (conHora(a)) {
      const st = MM(a.start), en = MM(a.end);
      if (st!=null && en!=null) {
        if (enCurso(a)) enCursoA.push(a);
        else if (nowMin < st) proximas.push(a);
        else pasadas.push(a);
        continue;
      }
    }
    sinHora.push(a);
  }

  enCursoA.sort((a,b)=>(a.start||'').localeCompare(b.start||''));
  proximas.sort((a,b)=>(a.start||'').localeCompare(b.start||''));
  pasadas.sort((a,b)=>(b.end||'').localeCompare(a.end||''));
  sinHora.sort((a,b)=>(a.descripcion||'').localeCompare(b.descripcion||''));
  documentos.sort((a,b)=>(a.descripcion||'').localeCompare(b.descripcion||''));

  const lista = [...enCursoA, ...proximas, ...pasadas, ...sinHora, ...documentos];

  // ===== PINTAR (todo menos completadas) =====
  lista.forEach(act => {
    const actDiv = document.createElement('div');
    actDiv.classList.add('actividad-item', act.tipo.toLowerCase());
    if (act.completado) actDiv.classList.add('actividad-completada');

    const subtipo =
      (act.tipo==='Tarea' && act.appointment_id!=null && act.requirement_index!=null) ? 'requisito' :
      (act.tipo==='Tarea' && act.improvement_id!=null)                                 ? 'mejora'    :
      (act.tipo==='Tarea' && act.document_id!=null)                                    ? 'documento' :
      (act.tipo==='Rutina')                                                            ? 'rutina'    : 'tarea';
    actDiv.classList.add(`subtipo-${subtipo}`);

    // tiempo/estado
    let tiempo = '';
    let startsSoon = false;
    let estaEnCurso = false;

    if (act.start && act.start.includes(':')) {
      const [sh, sm] = act.start.split(':').map(Number);
      const inicio = new Date(); inicio.setHours(sh, sm, 0, 0);
      const diffInicio = inicio - new Date();

      if (diffInicio > 0) {
        const min = Math.floor(diffInicio / 60000);
        if (min < 60) { if (min < 30) startsSoon = true; tiempo = `Empieza en ${min} min`; }
        else if (min < 1440) { const horas = Math.floor(min / 60); const minutos = min % 60; tiempo = `Empieza en ${horas} h ${minutos} min`; }
        else { const dias = Math.floor(min / 1440); const horas = Math.floor((min % 1440) / 60); tiempo = `Empieza en ${dias} d ${horas} h`; }
      } else if (act.end && act.end.includes(':')) {
        const [eh, em] = act.end.split(':').map(Number);
        const fin = new Date(); fin.setHours(eh, em, 0, 0);
        const diffFin = fin - new Date();

        if (diffFin > 0) {
          estaEnCurso = true;
          const min = Math.floor(diffFin / 60000);
          if (min >= 60) { const horas = Math.floor(min / 60); const minutos = min % 60; tiempo = `Termina en ${horas} h${minutos ? ` ${minutos} min` : ''}`; }
          else { tiempo = `Termina en ${min} min`; }
        } else { tiempo = 'Terminada'; }
      } else { tiempo = 'En curso'; estaEnCurso = true; }
    } else { tiempo = 'Sin hora'; }

    // descripción + chips
    let descripcionHTML = limpiarEtiquetasDescripcion(act.descripcion);
    if (act.tipo === 'Tarea' && act.document_id) {
      descripcionHTML = descripcionHTML.replace(
        /\((?:quedan \d+ d[ií]as|CADUCA HOY|CADUCADO)\)/i,
        m => `<span class="doc-countdown">${m}</span>`
      );
    }

    const esRequisitoDeCita = act.tipo === 'Tarea' && act.appointment_id != null && act.requirement_index != null;
    const esDocumento = act.tipo === 'Tarea' && act.document_id != null;
    const borrarBtnHtml = (esRequisitoDeCita || esDocumento) ? '' : `
      <button class="btn-borrar" data-id="${act.id}" data-tipo="${act.tipo}"
              ${act.appointment_id != null ? `data-aid="${act.appointment_id}"` : ''}
              ${act.requirement_index != null ? `data-idx="${act.requirement_index}"` : ''}>
        <span class="circle-btn red">🗑️</span>
      </button>`;

    const checkBtnHtml = (act.tipo === 'Tarea') ? `
      <button class="btn-check" data-id="${act.id}" data-tipo="${act.tipo}" data-completado="${act.completado}"
              ${act.appointment_id != null ? `data-aid="${act.appointment_id}"` : ''}
              ${act.requirement_index != null ? `data-idx="${act.requirement_index}"` : ''}
              ${act.improvement_id != null ? `data-improvement-id="${act.improvement_id}"` : ''}>
        <span class="circle-btn green">✔️</span>
      </button>` : '';

    actDiv.dataset.id   = act.id;
    actDiv.dataset.tipo = act.tipo.toLowerCase();
    actDiv.dataset.start = act.start || '';
    actDiv.dataset.end   = act.end   || '';
if (act.tipo === 'Tarea' && !act.completado) {
  actDiv.classList.add('draggable-task');
  actDiv.setAttribute('draggable', 'true');
} else {
  actDiv.removeAttribute('draggable');
}
    if (estaEnCurso && !act.completado) actDiv.classList.add('actividad-encurso');
    if (startsSoon && !act.completado)  actDiv.classList.add('latido');

    actDiv.innerHTML = `
      <div class="actividad-info">
        <span class="actividad-hora">
          ${formatHora(act.start)}${formatHora(act.end) ? ` - ${formatHora(act.end)}` : ''}
        </span>
        <span class="actividad-descripcion">
          <span class="actividad-chip subtipo-${subtipo}">
            ${subtipo === 'tarea' ? 'Tarea' : (subtipo === 'requisito' ? 'Requisito' : (subtipo === 'mejora' ? 'Mejora' : (subtipo === 'documento' ? 'Documento' : 'Rutina')))}
          </span>
          ${descripcionHTML}
        </span>
        <span class="actividad-tiempo">${tiempo}</span>
      </div>
      <div class="actividad-actions">
        ${checkBtnHtml}
        <button class="btn-editar" data-id="${act.id}" data-tipo="${act.tipo}">
          <span class="circle-btn yellow">✏️</span>
        </button>
        ${borrarBtnHtml}
      </div>
    `;

    container.appendChild(actDiv);
  });

  // ===== COMPLETADAS (plegadas) =====
  if (completadas.length) {
    const details = document.createElement('details');
    details.className = 'completadas-bloque';
    details.open = false;
    const summary = document.createElement('summary');
    summary.textContent = `✔️ Completadas (${completadas.length})`;
    details.appendChild(summary);

    const cont = document.createElement('div');
    completadas.forEach(act => {
      const el = document.createElement('div');
      el.className = 'actividad-item actividad-completada';
      el.innerHTML = `
        <div class="actividad-info">
          <span class="actividad-hora">
            ${formatHora(act.start)}${formatHora(act.end) ? ` - ${formatHora(act.end)}` : ''}
          </span>
          <span class="actividad-descripcion">${limpiarEtiquetasDescripcion(act.descripcion)}</span>
          <span class="actividad-tiempo">Completada</span>
        </div>`;
      cont.appendChild(el);
    });

    details.appendChild(cont);
    container.appendChild(details);
  }

  agregarEventos();
  initDragAndDropTareas();
}


function parseHHMM(str) { if (!str || !str.includes(':')) return null; const [h, m] = str.split(':').map(Number); return Number.isInteger(h)&&Number.isInteger(m)?{h,m}:null; }
function fmtHHMM({h, m}) { return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function addMinutes({h, m}, add){ let tot=h*60+m+add; tot=((tot%1440)+1440)%1440; return {h:Math.floor(tot/60), m:tot%60}; }
function roundToNext15({h, m}){ const t=h*60+m; const r=Math.ceil(t/15)*15; return {h:Math.floor(r/60), m:r%60}; }
function duracionPorDefecto(subtipo){ if (subtipo==='requisito') return 15; if (subtipo==='mejora') return 25; return 30; }

function normalizaRango(iniStr, finStr, subtipo = 'tarea') {
  const def = duracionPorDefecto(subtipo) || 30;
  const ini = parseHHMM(iniStr);
  const fin = parseHHMM(finStr);

  if (!ini && !fin) return { ini: null, fin: null }; // sin hora

  if (ini && !fin) {
    const finCalc = addMinutes(ini, def);
    return { ini: fmtHHMM(ini), fin: fmtHHMM(finCalc) };
  }

  if (!ini && fin) {
    // si solo dan fin, ponemos inicio = fin - def
    const iniCalc = addMinutes(fin, -def);
    return { ini: fmtHHMM(iniCalc), fin: fmtHHMM(fin) };
  }

  // ambos existen: asegurar fin > ini; si no, empujamos fin a +def
  const iniMin = ini.h * 60 + ini.m;
  const finMin = fin.h * 60 + fin.m;
  if (finMin <= iniMin) {
    const finCalc = addMinutes(ini, def);
    return { ini: fmtHHMM(ini), fin: fmtHHMM(finCalc) };
  }
  return { ini: fmtHHMM(ini), fin: fmtHHMM(fin) };
}


// DnD simple (sin rutinas): reordena y reasigna horas en secuencia
async function initDragAndDropTareas(){
  const root = document.getElementById('agenda-container');
  if (!root) return;

    // 🚫 Evita re-registrar los mismos listeners en cada render
  if (DND_INIT) return;
  DND_INIT = true;

  // util tiempo
  const toMin = s => (s && s.includes(':')) ? ((t)=>{const[a,b]=t.split(':').map(Number);return a*60+b;})(s) : null;
  const fmMin = m => { m=((m%1440)+1440)%1440; const h=String(Math.floor(m/60)).padStart(2,'0'); const n=String(m%60).padStart(2,'0'); return `${h}:${n}`; };
  const DEFAULT = 30, MIN_DAY=0, MAX_DAY=1440;

  // bloques ocupados (incluye RUTINAS como fijas)
  const getBlocks = (excludeId) => {
    const items = [...root.querySelectorAll('.actividad-item')];
    const blocks = [];
    for (const el of items){
      if (el.dataset.id === excludeId) continue;
      const tipo  = el.dataset.tipo;              // ya lo tienen TODAS las tarjetas (paso 1)
      const s     = toMin(el.dataset.start || '');
      const e     = toMin(el.dataset.end   || '');
      const horaria = (s!=null && e!=null && e>s);
      const fija  = (tipo === 'rutina');
      if (horaria) blocks.push({ start:s, end:e, fija, el });
    }
    blocks.sort((a,b)=>a.start-b.start);
    return blocks;
  };

  const between = (prev, next, want=DEFAULT) => {
    const s = prev ? prev.end : MIN_DAY;
    const e = next ? next.start : MAX_DAY;
    if (e<=s) return null;
    const dur = Math.min(want, e - s);           // adapta si hueco < 30'
    return { start:s, end:s+dur };
  };

  const computeSlot = (blocks, target, side, fallbackY) => {
    if (target){
      const i = blocks.indexOf(target);
      const prev = blocks[i-1] || null;
      const next = blocks[i+1] || null;

      if (side==='before'){
        const end = target.start;
        const startLimit = prev ? prev.end : MIN_DAY;
        const dur = Math.min(DEFAULT, Math.max(0, end - startLimit));
        if (dur>0) return { start:end-dur, end };
        return between(prev, target, DEFAULT);
      } else {
        const start = target.end;
        const endLimit = next ? next.start : MAX_DAY;
        const dur = Math.min(DEFAULT, Math.max(0, endLimit - start));
        if (dur>0) return { start, end:start+dur };
        return between(target, next, DEFAULT);
      }
    }
    // sin target claro: encaja ENTRE vecinos según Y
    const allEls = [...root.querySelectorAll('.actividad-item')];
    let idx = allEls.findIndex(it => it.getBoundingClientRect().top > fallbackY);
    if (idx<0) idx = allEls.length;
    const prev = [...blocks].reverse().find(b => allEls.indexOf(b.el) < idx) || null;
    const next = blocks.find(b => allEls.indexOf(b.el) >= idx) || null;
    return between(prev, next, DEFAULT);
  };

  // marcador visual con hora sugerida
  let dragging=null, overEl=null, side=null, lastY=0;
  const placeholder = document.createElement('div');
  placeholder.className='drop-marker';
  const hint = document.createElement('span');
  hint.className='drop-hint';
  placeholder.appendChild(hint);

 root.addEventListener('dragstart', (e)=>{
  const t = e.target;
  if (!(t instanceof Element)) return;
  const el = t.closest('.actividad-item.draggable-task');
  if (!el) return;
    dragging = el;
    dragging.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
  });

  root.addEventListener('dragend', ()=>{
    dragging?.classList.remove('dragging');
    placeholder.remove();
    dragging=null; overEl=null; side=null;
  });

  // guardar Y para casos sin target claro
  root.addEventListener('dragover', (e)=>{ lastY = e.clientY; }, { capture:true });

  root.addEventListener('dragover', (e)=>{
    if (!dragging) return;
    e.preventDefault();
    const el = e.target.closest('.actividad-item');
    if (!el || el===dragging) return;

    const r = el.getBoundingClientRect();
    const s = (e.clientY < r.top + r.height/2) ? 'before' : 'after';
    if (el!==overEl || s!==side){
      overEl = el; side = s;

      const blocks = getBlocks(dragging.dataset.id);
      const oStart = toMin(el.dataset.start||'');
      const oEnd   = toMin(el.dataset.end||'');
      const target = (oStart!=null && oEnd!=null) ? blocks.find(b=>b.start===oStart && b.end===oEnd) : null;

      const slot = computeSlot(blocks, target, s, lastY);

      placeholder.classList.toggle('invalid', !slot);
      hint.textContent = slot ? `${fmMin(slot.start)}–${fmMin(slot.end)}` : 'Sin hueco';

      placeholder.remove();
      (s==='before') ? el.parentNode.insertBefore(placeholder, el)
                     : el.parentNode.insertBefore(placeholder, el.nextSibling);
    }
  });

   root.addEventListener('drop', async ()=>{
    if (!dragging) return;

    const blocks = getBlocks(dragging.dataset.id);
    let target = null;
    if (overEl) {
      const oStart = toMin(overEl.dataset.start||'');
      const oEnd   = toMin(overEl.dataset.end||'');
      target = (oStart!=null && oEnd!=null) ? blocks.find(b=>b.start===oStart && b.end===oEnd) : null;
    }

const slot = computeSlot(blocks, target, side, lastY);
    placeholder.remove();
    if (!slot) return;

    const startHH = fmMin(slot.start);
    const endHH   = fmMin(slot.end);

    const { error } = await supabase
      .from('tasks')
      .update({ start_time: startHH, end_time: endHH })
      .eq('id', dragging.dataset.id);
    if (error) { console.error('[AGENDA] No se pudo reprogramar:', error); return; }

    await cargarAgendaHoy();
  });
}

// === Eventos (completar / editar / borrar) ===
function agregarEventos() {
  const root = document.getElementById('agenda-container');
  if (!root) return;

  // Delegación de eventos en un único listener
  root.addEventListener('click', async (ev) => {
  const t = ev.target;
  if (!(t instanceof Element)) return;
  const btn = t.closest('button');
  if (!btn) return;

// 1) COMPLETAR / DESCOMPLETAR
if (btn.classList.contains('btn-check')) {
  const id   = btn.dataset.id;
  const tipo = btn.dataset.tipo;
  if (tipo !== 'Tarea') return; // Rutina: no hace nada

  const current = btn.dataset.completado === 'true';

  // (A) Actualiza la task
  const { error } = await supabase
    .from('tasks')
    .update({ is_completed: !current })
    .eq('id', id)
    .single();

  if (error) {
    console.error('[AGENDA] completar error', error);
    alert('No se pudo cambiar el estado.');
    return;
  }

  // (B) Si es un REQUISITO (tiene appointment_id + requirement_index),
  //     sincroniza también appointments.requirements[idx].checked
  const aid = btn.dataset.aid;
  const idx = btn.dataset.idx;

  if (aid != null && idx != null) {
    const { data: appt, error: eAppt } = await supabase
      .from('appointments')
      .select('id, requirements')
      .eq('id', aid)
      .maybeSingle();

    if (!eAppt && appt && Array.isArray(appt.requirements)) {
      const i = Number(idx);
      const reqs = [...appt.requirements];
      if (i >= 0 && i < reqs.length) {
        reqs[i] = { ...(reqs[i] || {}), checked: !current };
        await supabase.from('appointments').update({ requirements: reqs }).eq('id', aid);
        // avisa a otras vistas (p. ej., "Últimas citas") para que refresquen
        window.dispatchEvent(new Event('requisito-actualizado'));
      }
    }
  }

  await cargarAgendaHoy();
  return;
}



// 2) EDITAR
if (btn.classList.contains('btn-editar')) {
  const id   = btn.dataset.id;
  const tipo = btn.dataset.tipo;

  if (tipo === 'Tarea') {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) { alert('No se pudo abrir la tarea.'); return; }

  document.getElementById('editar-id-tarea').value = data.id;
  document.getElementById('editar-tipo').value     = 'Tarea';
  document.getElementById('editar-descripcion-tarea').value = data.description || '';
  document.getElementById('editar-fecha-tarea').value       = (data.due_date || '').slice(0,10);
  document.getElementById('editar-hora-inicio-tarea').value = (data.start_time || '').slice(0,5);
  document.getElementById('editar-hora-fin-tarea').value    = (data.end_time   || '').slice(0,5);

  // ✅ Normaliza antes de enseñar el modal
  const nrm = normalizaRango(
    document.getElementById('editar-hora-inicio-tarea').value || '',
    document.getElementById('editar-hora-fin-tarea').value || '',
    'tarea'
  );
  document.getElementById('editar-hora-inicio-tarea').value = nrm.ini || '';
  document.getElementById('editar-hora-fin-tarea').value    = nrm.fin || '';

  document.getElementById('form-editar-tarea').classList.remove('oculto');
  return;
}


  // Tras setear los valores:
const subtipo = (tipo === 'Rutina') ? 'rutina' : 'tarea';
const ini0 = document.getElementById('editar-hora-inicio-tarea').value || '';
const fin0 = document.getElementById('editar-hora-fin-tarea').value || '';
const nrm0 = normalizaRango(ini0, fin0, subtipo);
document.getElementById('editar-hora-inicio-tarea').value = nrm0.ini || '';
document.getElementById('editar-hora-fin-tarea').value    = nrm0.fin || '';


  if (tipo === 'Rutina') {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) { alert('No se pudo abrir la rutina.'); return; }

  document.getElementById('editar-id-tarea').value = data.id;
  document.getElementById('editar-tipo').value     = 'Rutina';
  document.getElementById('editar-descripcion-tarea').value = data.description || '';
  document.getElementById('editar-fecha-tarea').value       = (data.date || '').slice(0,10);
  document.getElementById('editar-hora-inicio-tarea').value = (data.start_time || '').slice(0,5);
  document.getElementById('editar-hora-fin-tarea').value    = (data.end_time   || '').slice(0,5);

  // ✅ Normaliza antes de enseñar el modal
  const nrm = normalizaRango(
    document.getElementById('editar-hora-inicio-tarea').value || '',
    document.getElementById('editar-hora-fin-tarea').value || '',
    'rutina'
  );
  document.getElementById('editar-hora-inicio-tarea').value = nrm.ini || '';
  document.getElementById('editar-hora-fin-tarea').value    = nrm.fin || '';

  document.getElementById('form-editar-tarea').classList.remove('oculto');
  return;
}

}


  // 3) BORRAR
if (btn.classList.contains('btn-borrar')) {
  const id   = btn.dataset.id;
  const tipo = btn.dataset.tipo;

  if (tipo === 'Tarea') {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) {
      console.error('[AGENDA] borrar tarea error', error);
      alert('No se pudo borrar.');
      return;
    }
    await cargarAgendaHoy();
    return;
  }

  if (tipo === 'Rutina') {
    // OJO: la tabla es 'routines'
    const { error } = await supabase.from('routines').delete().eq('id', id);
    if (error) {
      console.error('[AGENDA] borrar rutina error', error);
      alert('No se pudo borrar.');
      return;
    }
    await cargarAgendaHoy();
    return;
  }
}

  });
}




// Arranque + refrescos externos
cargarAgendaHoy();
window.cargarAgendaHoy = cargarAgendaHoy;
window.addEventListener('requisito-actualizado', () => cargarAgendaHoy());
window.addEventListener('cita-borrada', () => cargarAgendaHoy());

// === asignarHoraAlSoltar (…) — mantén tu función tal como la tienes al final ===


// === Modal Editar Tarea ===
const modalEditTarea = document.getElementById('form-editar-tarea');
const formEditTarea  = document.getElementById('editar-formulario-tarea');

document.getElementById('recoger-edicion-tarea')?.addEventListener('click', () => {
  modalEditTarea?.classList.add('oculto');
});

formEditTarea?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id    = document.getElementById('editar-id-tarea').value;
  const tipo  = document.getElementById('editar-tipo').value || 'Tarea';
  const desc  = document.getElementById('editar-descripcion-tarea').value.trim();
  const fecha = document.getElementById('editar-fecha-tarea').value || null;
  const ini   = document.getElementById('editar-hora-inicio-tarea').value || '';
  const fin   = document.getElementById('editar-hora-fin-tarea').value || '';

  // ✅ Normaliza antes de construir el update
  const { ini: iniN, fin: finN } = normalizaRango(ini, fin, (tipo === 'Rutina') ? 'rutina' : 'tarea');

  const table  = (tipo === 'Rutina') ? 'routines' : 'tasks';
  const update = (tipo === 'Rutina')
    ? { description: desc || null, date: fecha,     start_time: iniN, end_time: finN }
    : { description: desc || null, due_date: fecha, start_time: iniN, end_time: finN };

  const { error } = await supabase.from(table).update(update).eq('id', id);
  if (error) { alert('No se pudo guardar.'); return; }

  document.getElementById('form-editar-tarea').classList.add('oculto');
  await cargarAgendaHoy();
});


const $ini = document.getElementById('editar-hora-inicio-tarea');
const $fin = document.getElementById('editar-hora-fin-tarea');

function autoAjustar() {
  const tipo = document.getElementById('editar-tipo').value || 'Tarea';
  const subtipo = (tipo === 'Rutina') ? 'rutina' : 'tarea';
  const n = normalizaRango($ini.value || '', $fin.value || '', subtipo);
  $ini.value = n.ini || '';
  $fin.value = n.fin || '';
}

$ini?.addEventListener('change', autoAjustar);
$fin?.addEventListener('change', autoAjustar);


