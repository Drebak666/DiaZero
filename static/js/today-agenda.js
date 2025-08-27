// today-agenda.js — Agenda de HOY (tareas + rutinas)
// ahora incluye: propias + de grupo + COMPARTIDAS

import { supabase } from './supabaseClient.js';
import { planificarMejorasHoy } from './mejoras-planner.js';

function limpiarEtiquetasDescripcion(txt) {
  if (!txt) return '';
  return txt.replace(/^\s*\[(?:mejora|cita|tarea|requisito|documento|rutina)\]\s*/i, '');
}

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
const uniqById = (rows) => { const m = new Map(); (rows||[]).forEach(r => m.set(r.id, r)); return [...m.values()]; };

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

  // 🧑‍🤝‍🧑 Mis grupos (para tareas/rutinas de grupo)
  const { data: memb } = await supabase.from('miembros_grupo').select('grupo_id').eq('usuario_id', uid);
  const misGrupos = (memb || []).map(r => r.grupo_id);

  // 🔗 IDs compartidos conmigo
  const [{ data: tLinks }, { data: rLinks }] = await Promise.all([
    supabase.from('actividades_compartidas').select('actividad_id').eq('usuario_id', uid).eq('tipo', 'tarea'),
    supabase.from('actividades_compartidas').select('actividad_id').eq('usuario_id', uid).eq('tipo', 'rutina'),
  ]);
  const idsTareasCompartidas  = (tLinks || []).map(x => x.actividad_id);
  const idsRutinasCompartidas = (rLinks || []).map(x => x.actividad_id);

  // 🧹 Limpieza/movimiento SOLO de mis tareas (no tocar compartidas)
  await supabase.from('tasks').delete().lt('due_date', hoyStr).eq('is_completed', true).eq('usuario', uid);
  await supabase.from('tasks').update({ due_date: hoyStr }).lt('due_date', hoyStr).eq('is_completed', false).eq('usuario', uid).is('improvement_id', null);

  // ✅ TAREAS HOY: propias + grupo + compartidas
  const [tOwn, tGrp, tInd] = await Promise.all([
    supabase.from('tasks').select('*').eq('due_date', hoyStr).eq('usuario', uid),
    misGrupos.length
      ? supabase.from('tasks').select('*').eq('due_date', hoyStr).in('grupo_id', misGrupos)
      : Promise.resolve({ data: [] }),
    idsTareasCompartidas.length
      ? supabase.from('tasks').select('*').eq('due_date', hoyStr).in('id', idsTareasCompartidas)
      : Promise.resolve({ data: [] }),
  ]);
  const tareas = uniqById([...(tOwn.data||[]), ...(tGrp.data||[]), ...(tInd.data||[])]);

  if (tareas.length) {
    // Fechas de caducidad de documentos vinculados
    let docCaducidades = {};
    const docIds = tareas.map(t => t.document_id).filter(Boolean);
    if (docIds.length) {
      const uniques = [...new Set(docIds)];
      const { data: docs } = await supabase.from('documentos').select('id,caduca_el,usuario').in('id', uniques);
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
    supabase.from('routines').select('*').eq('is_active', true).eq('usuario', uid),
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

  const ordenPrioridad = { tarea:1, rutina:2, requisito:3, documento:4, mejora:5 };

  function subtipoParaOrden(x) {
    if (x.tipo === 'Rutina') return 'rutina';
    if (x.tipo === 'Tarea') {
      if (x.appointment_id != null && x.requirement_index != null) return 'requisito';
      if (x.improvement_id != null) return (x.start && x.start.includes(':')) ? 'tarea' : 'mejora';
      if (x.document_id != null) return 'documento';
      return 'tarea';
    }
    return 'tarea';
  }

  actividades.sort((a, b) => {
    if (a.completado !== b.completado) return a.completado ? 1 : -1;
    const sa = subtipoParaOrden(a), sb = subtipoParaOrden(b);
    if (sa !== sb) return (ordenPrioridad[sa] || 99) - (ordenPrioridad[sb] || 99);
    return (a.start || '').localeCompare(b.start || '');
  });

  // === ORDEN NUEVO ===
  const timedActive = [], sinHora = [], documentos = [], completadas = [];
  for (const a of actividades) {
    if (a.completado) { completadas.push(a); continue; }
    const esDoc = (a.tipo === 'Tarea' && a.document_id != null);
    const tieneHora = !!(a.start && a.start.includes(':'));
    if (esDoc) documentos.push(a);
    else if (tieneHora) timedActive.push(a);
    else sinHora.push(a);
  }
  timedActive.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  documentos.sort((a, b) => {
    const la = (a.doc_days_left ?? 9e9), lb = (b.doc_days_left ?? 9e9);
    if (la !== lb) return la - lb;
    return (a.descripcion || '').localeCompare(b.descripcion || '');
  });
  completadas.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const lista = [...timedActive, ...sinHora, ...documentos, ...completadas];

  lista.forEach(act => {
    const actDiv = document.createElement('div');
    actDiv.classList.add('actividad-item', act.tipo.toLowerCase());
    if (act.completado) actDiv.classList.add('actividad-completada');

    const subtipo =
      (act.tipo === 'Tarea' && act.appointment_id != null && act.requirement_index != null) ? 'requisito' :
      (act.tipo === 'Tarea' && act.improvement_id != null)                                   ? 'mejora'    :
      (act.tipo === 'Tarea' && act.document_id != null)                                      ? 'documento' :
      (act.tipo === 'Rutina')                                                                ? 'rutina'    :
                                                                                                'tarea';
    actDiv.classList.add(`subtipo-${subtipo}`);

    const esArrastrable = (subtipo === 'tarea' || subtipo === 'requisito' || subtipo === 'mejora') && !act.completado;
    if (esArrastrable) {
      actDiv.setAttribute('draggable', 'true');
      actDiv.classList.add('draggable-task');
      actDiv.dataset.id = act.id;
      actDiv.dataset.subtipo = subtipo;
      actDiv.dataset.sinHora = act.start ? '0' : '1';
    }

    if (act.tipo === 'Tarea' && act.document_id) {
      actDiv.classList.add('actividad-doc');
      const left = act.doc_days_left;
      if (left != null) {
        if (left < 0)        actDiv.classList.add('estado-expired');
        else if (left === 0) actDiv.classList.add('estado-today');
        else if (left <= 30) actDiv.classList.add('estado-soon');
      }
    }

    // Tiempo / estado (incluye "En curso")
    let tiempo = '';
    let startsSoon = false;
    let enCurso = false;

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
          enCurso = true;
          const min = Math.floor(diffFin / 60000);
          if (min >= 60) { const horas = Math.floor(min / 60); const minutos = min % 60; tiempo = `Termina en ${horas} h${minutos ? ` ${minutos} min` : ''}`; }
          else { tiempo = `Termina en ${min} min`; }
        } else { tiempo = 'Terminada'; }
      } else { tiempo = 'En curso'; enCurso = true; }
    } else { tiempo = 'Sin hora'; }

    // Descripción
    let descripcionHTML = limpiarEtiquetasDescripcion(act.descripcion);
    if (act.tipo === 'Tarea' && act.document_id) {
      descripcionHTML = descripcionHTML.replace(
        /\((?:quedan \d+ d[ií]as|CADUCA HOY|CADUCADO)\)/i,
        m => `<span class="doc-countdown">${m}</span>`
      );
    }

    const esRequisitoDeCita = act.tipo === 'Tarea' && act.appointment_id != null && act.requirement_index != null;
    const borrarBtnHtml = esRequisitoDeCita ? '' : `
      <button class="btn-borrar" data-id="${act.id}" data-tipo="${act.tipo}"
              ${act.appointment_id != null ? `data-aid="${act.appointment_id}"` : ''}
              ${act.requirement_index != null ? `data-idx="${act.requirement_index}"` : ''}>
        <span class="circle-btn red">🗑️</span>
      </button>`;

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
        <button class="btn-check" data-id="${act.id}" data-tipo="${act.tipo}" data-completado="${act.completado}"
                ${act.tipo === 'Rutina' ? 'disabled' : ''}
                ${act.appointment_id != null ? `data-aid="${act.appointment_id}"` : ''}
                ${act.requirement_index != null ? `data-idx="${act.requirement_index}"` : ''}
                ${act.improvement_id != null ? `data-improvement-id="${act.improvement_id}"` : ''}>
          <span class="circle-btn green">✔️</span>
        </button>
        <button class="btn-editar" data-id="${act.id}" data-tipo="${act.tipo}">
          <span class="circle-btn yellow">✏️</span>
        </button>
        ${borrarBtnHtml}
      </div>
    `;

    if (startsSoon && !act.completado) actDiv.classList.add('latido');
    if (enCurso && !act.completado)    actDiv.classList.add('actividad-encurso');

    container.appendChild(actDiv);
  });

  agregarEventos();
  initDragAndDropTareas();
}

function parseHHMM(str) { if (!str || !str.includes(':')) return null; const [h, m] = str.split(':').map(Number); return Number.isInteger(h)&&Number.isInteger(m)?{h,m}:null; }
function fmtHHMM({h, m}) { return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function addMinutes({h, m}, add){ let tot=h*60+m+add; tot=((tot%1440)+1440)%1440; return {h:Math.floor(tot/60), m:tot%60}; }
function roundToNext15({h, m}){ const t=h*60+m; const r=Math.ceil(t/15)*15; return {h:Math.floor(r/60), m:r%60}; }
function duracionPorDefecto(subtipo){ if (subtipo==='requisito') return 15; if (subtipo==='mejora') return 25; return 30; }

// DnD simple (sin rutinas): reordena y reasigna horas en secuencia
async function initDragAndDropTareas() { /* … (igual que tu versión actual) … */ }
// (dejo intactas tus funciones reprogramarSecuencialSimple, mostrarToast, asignarHoraAlSoltar, etc.)

// === Eventos (completar/borrar/editar) — se mantienen tal cual ===
// Nota: en tareas/rutinas compartidas, si RLS no permite UPDATE/DELETE al invitado,
// verás un error en consola; la UI se refresca igualmente.
function agregarEventos() { /* … (tu mismo bloque actual sin cambios) … */ }

// Arranque + refrescos externos
cargarAgendaHoy();
window.cargarAgendaHoy = cargarAgendaHoy;
window.addEventListener('requisito-actualizado', () => cargarAgendaHoy());
window.addEventListener('cita-borrada', () => cargarAgendaHoy());

// === asignarHoraAlSoltar (…) — mantén tu función tal como la tienes al final ===
