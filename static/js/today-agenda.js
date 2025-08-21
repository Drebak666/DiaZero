import { supabase } from './supabaseClient.js';
import { planificarMejorasHoy } from './mejoras-planner.js';

function limpiarEtiquetasDescripcion(txt) {
  if (!txt) return '';
  // Quita una etiqueta inicial en corchetes: [Mejora], [Cita], [Tarea], [Requisito], [Documento], [Rutina]
  return txt.replace(/^\s*\[(?:mejora|cita|tarea|requisito|documento|rutina)\]\s*/i, '');
}


const container = document.getElementById('agenda-container');

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
function rutinaTerminadaHoy(rutina) {
  if (!rutina.end_time || !rutina.end_time.includes(':')) return false;
  const ahora = new Date();
  const [h, m] = rutina.end_time.split(':').map(Number);
  const fin = new Date();
  fin.setHours(h, m, 0, 0);
  return ahora > fin;
}
function formatHora(hora) {
  if (!hora || hora === '00:00:00') return '';
  return hora.slice(0,5);
}
function daysLeft(dateStr){
  if(!dateStr) return null;
  const t=new Date(); t.setHours(0,0,0,0);
  const d=new Date(dateStr); d.setHours(0,0,0,0);
  return Math.round((d - t)/86400000);
}
// === Helpers de grupos ===
async function resolverUsuarioIdPorUsername(username) {
  if (!username) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (error || !data) return null;
  return data.id; // uuid
}

async function gruposIdsDelUsuarioActual() {
  const stored = localStorage.getItem('usuario_actual') || null;
  const myId = await resolverUsuarioIdPorUsername(stored);
  if (!myId) return [];
  const { data, error } = await supabase
    .from('miembros_grupo')
    .select('grupo_id')
    .eq('usuario_id', myId);
  if (error || !data) return [];
  return data.map(r => r.grupo_id); // array de uuid
}


async function cargarAgendaHoy() {
  const hoy = new Date();
  const diaSemanaEsp = hoy.toLocaleDateString('es-ES', { weekday: 'long' });
  const hoyStr = hoy.toISOString().split('T')[0];
  let actividades = [];

  // 🔸 Planificar mejoras del día (idempotente por UNIQUE)
  await planificarMejorasHoy({
    presupuestoMin: 60,
    bloquesPermitidos: [25, 15],
    maxTareas: 4
  });

const { data: { user } } = await supabase.auth.getUser();
const uid    = user?.id || null;                                   // UUID
const email  = user?.email || null;                                // email (compat)
const stored = localStorage.getItem('usuario_actual') || null;     // por si hay fallback
const who = [uid, email, stored].filter(Boolean);                  // acepta ambos
// === Grupos del usuario actual (para compartir actividades) ===
const grupos = await gruposIdsDelUsuarioActual();

// Construir cláusula OR: (usuario == cualquiera en 'who') OR (grupo_id IN mis grupos)
const usuarioClauses = who.map(v => `usuario.eq.${v}`).join(',');
const orFiltro = grupos.length
  ? (usuarioClauses ? `${usuarioClauses},grupo_id.in.(${grupos.join(',')})` 
                    : `grupo_id.in.(${grupos.join(',')})`)
  : (usuarioClauses || 'usuario.eq.__none__'); // evita or vacío


if (!who.length) {
  console.warn('[AGENDA] No hay usuario autenticado');
  renderizarActividades([]);
  return;
}


// BORRAR tareas completadas de días anteriores (solo del usuario actual)
const { error: delErr } = await supabase
  .from('tasks')
  .delete()
  .lt('due_date', hoyStr)
  .eq('is_completed', true)
.in('usuario', who)
if (delErr) console.error('❌ Error borrando tareas viejas:', delErr);


// MOVER SOLO tareas normales (sin improvement) de días anteriores al día actual
const { error: updErr } = await supabase
  .from('tasks')
  .update({ due_date: hoyStr })
  .lt('due_date', hoyStr)
  .eq('is_completed', false)
.in('usuario', who)
  .is('improvement_id', null);   // 👈 clave: NO tocar mejoras
if (updErr) console.error('❌ Error moviendo tareas viejas:', updErr);


// TAREAS (incluyendo requisitos, mejoras y documentos)
// TAREAS (incluye propias o de mis grupos)
let qTasks = supabase
  .from('tasks')
  .select('*')
  .eq('due_date', hoyStr);

qTasks = qTasks.or(orFiltro);

const { data: tareas, error: errorTareas } = await qTasks;


if (!errorTareas && tareas) {
  // ➊ leer las fechas de caducidad de los documentos asociados a estas tareas
  let docCaducidades = {};
  const docIds = tareas.map(t => t.document_id).filter(Boolean);
  if (docIds.length) {
    const uniques = [...new Set(docIds)];
    const { data: docs, error: docsErr } = await supabase
      .from('documentos')
      .select('id,caduca_el,usuario')
      .in('id', uniques)
    if (!docsErr && docs) {
      docCaducidades = Object.fromEntries(docs.map(d => [d.id, d.caduca_el]));
    }
  }

  // ➋ construir las actividades (añadimos document_id y doc_days_left)
const tareasFormateadas = tareas.map(t => {
  const idxNum = Number.isFinite(Number(t.requirement_index))
    ? Number(t.requirement_index)
    : null;

  const caduca = t.document_id ? docCaducidades[t.document_id] : null;
  const left = caduca ? daysLeft(caduca) : null;

  // Construir descripción con cuenta atrás para documentos
  let descripcion = t.description;
  if (t.document_id && left != null) {
    let tag = null;
    if (left < 0)        tag = 'CADUCADO';
    else if (left === 0) tag = 'CADUCA HOY';
    else if (left <= 30) tag = `quedan ${left} días`;
    if (tag) descripcion = `${t.description} (${tag})`;
  }

  return {
    tipo: 'Tarea',
    id: t.id,
    descripcion,                   // 👈 ahora con cuenta atrás
    start: t.start_time || '',
    end: t.end_time || '',
    completado: t.is_completed,
    prioridad: t.priority,
    appointment_id: t.appointment_id ?? null,
    requirement_index: idxNum,
    improvement_id: t.improvement_id ?? null,
    document_id: t.document_id ?? null,
    doc_days_left: left            // 👈 seguimos guardando el left para estilos
  };
});


  actividades = actividades.concat(tareasFormateadas);
}


  // RUTINAS
  // RUTINAS (propias o de mis grupos)
let qRoutines = supabase
  .from('routines')
  .select('*')
  .eq('is_active', true);

qRoutines = qRoutines.or(orFiltro);

const { data: rutinas, error: errorRutinas } = await qRoutines;


  if (!errorRutinas && rutinas) {
    const rutinasDelDia = rutinas.filter(r => {
      const cumpleDiaSemana =
        Array.isArray(r.days_of_week) &&
        r.days_of_week.includes(capitalize(diaSemanaEsp));

      const f0 = (d) => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), new Date(d).getDate());
      const fechaInicio = f0(r.date);
      const fechaFin = r.end_date ? f0(r.end_date) : null;
      const fechaHoy = f0(hoy);

      return (
        cumpleDiaSemana &&
        fechaInicio <= fechaHoy &&
        (!fechaFin || fechaHoy <= fechaFin)
      );
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

  const ahora = new Date();

 const ordenPrioridad = { tarea:1, rutina:2, requisito:3, documento:4, mejora:5 };

function subtipoParaOrden(x) {
    if (x.tipo === 'Rutina') return 'rutina';
    if (x.tipo === 'Tarea') {
        if (x.appointment_id != null && x.requirement_index != null) return 'requisito';
        if (x.improvement_id != null) {
            // Mejora con hora -> se ordena como tarea normal
            return (x.start && x.start.includes(':')) ? 'tarea' : 'mejora';
        }
        if (x.document_id != null) return 'documento';
        return 'tarea';
    }
    return 'tarea';
}

actividades.sort((a, b) => {
    if (a.completado !== b.completado) return a.completado ? 1 : -1;
    const sa = subtipoParaOrden(a);
    const sb = subtipoParaOrden(b);
    if (sa !== sb) return (ordenPrioridad[sa] || 99) - (ordenPrioridad[sb] || 99);
    return (a.start || '').localeCompare(b.start || '');
});



// Antes de actividades.forEach(...)
// --- separar en conHora / sinHora ---
// --- separar en conHora / sinHora ---
const conHora = [];
const sinHora = [];

for (const a of actividades) {
  const tieneHora = !!(a.start && a.start.includes(':'));
  if (tieneHora) {
    conHora.push(a); // incluye tareas, mejoras, requisitos y rutinas con hora
  } else {
    sinHora.push(a); // todo sin hora, incluidas rutinas sin hora
  }
}

// --- ordenar las que tienen hora (completadas SIEMPRE al final) ---
conHora.sort((a, b) => {
  if (a.completado !== b.completado) {
    return a.completado ? 1 : -1; // completadas al final
  }
  return (a.start || '').localeCompare(b.start || '');
});

// --- lista final ---
const lista = [...conHora, ...sinHora];


lista.forEach(act => {
  const actDiv = document.createElement('div');
  actDiv.classList.add('actividad-item', act.tipo.toLowerCase());
  if (act.completado) actDiv.classList.add('actividad-completada');

  // Subtipo (colores/clases)
  const subtipo =
    (act.tipo === 'Tarea' && act.appointment_id != null && act.requirement_index != null) ? 'requisito' :
    (act.tipo === 'Tarea' && act.improvement_id != null)                                   ? 'mejora'    :
    (act.tipo === 'Tarea' && act.document_id != null)                                      ? 'documento' :
    (act.tipo === 'Rutina')                                                                ? 'rutina'    :
                                                                                             'tarea';
  actDiv.classList.add(`subtipo-${subtipo}`);

  // Arrastrables: tarea/requisito/mejora no completadas
  const esArrastrable = (subtipo === 'tarea' || subtipo === 'requisito' || subtipo === 'mejora') && !act.completado;
  if (esArrastrable) {
    actDiv.setAttribute('draggable', 'true');
    actDiv.classList.add('draggable-task');
    actDiv.dataset.id = act.id;
    actDiv.dataset.subtipo = subtipo;            // para duración por defecto
    actDiv.dataset.sinHora = act.start ? '0' : '1'; // 1 si no tiene hora
  }

  // Fondo especial para documentos según caducidad
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
  const ahora = new Date();
  let tiempo = '';
  let startsSoon = false;
  let enCurso = false;

  if (act.start && act.start.includes(':')) {
    const [sh, sm] = act.start.split(':').map(Number);
    const inicio = new Date(); inicio.setHours(sh, sm, 0, 0);
    const diffInicio = inicio - ahora;

    if (diffInicio > 0) {
      const min = Math.floor(diffInicio / 60000);
      if (min < 60) {
        if (min < 30) startsSoon = true;
        tiempo = `Empieza en ${min} min`;
      } else if (min < 1440) {
        const horas = Math.floor(min / 60);
        const minutos = min % 60;
        tiempo = `Empieza en ${horas} h ${minutos} min`;
      } else {
        const dias = Math.floor(min / 1440);
        const horas = Math.floor((min % 1440) / 60);
        tiempo = `Empieza en ${dias} d ${horas} h`;
      }
    } else if (act.end && act.end.includes(':')) {
      const [eh, em] = act.end.split(':').map(Number);
      const fin = new Date(); fin.setHours(eh, em, 0, 0);
      const diffFin = fin - ahora;

      if (diffFin > 0) {
        enCurso = true;
        const min = Math.floor(diffFin / 60000);
        if (min >= 60) {
          const horas = Math.floor(min / 60);
          const minutos = min % 60;
          tiempo = `Termina en ${horas} h${minutos > 0 ? ` ${minutos} min` : ''}`;
        } else {
          tiempo = `Termina en ${min} min`;
        }
      } else {
        tiempo = 'Terminada';
      }
    } else {
      tiempo = 'En curso';
      enCurso = true; // importante
    }
  } else {
    tiempo = 'Sin hora';
  }

  // Descripción (limpia etiqueta y resalta countdown de doc)
  let descripcionHTML = limpiarEtiquetasDescripcion(act.descripcion);
  if (act.tipo === 'Tarea' && act.document_id) {
    descripcionHTML = descripcionHTML.replace(
      /\((?:quedan \d+ d[ií]as|CADUCA HOY|CADUCADO)\)/i,
      m => `<span class="doc-countdown">${m}</span>`
    );
  }

  // Botones (oculta borrar si es requisito de cita)
  const esRequisitoDeCita = act.tipo === 'Tarea' && act.appointment_id != null && act.requirement_index != null;
  const borrarBtnHtml = esRequisitoDeCita ? '' : `
    <button class="btn-borrar"
            data-id="${act.id}"
            data-tipo="${act.tipo}"
            ${act.appointment_id != null ? `data-aid="${act.appointment_id}"` : ''}
            ${act.requirement_index != null ? `data-idx="${act.requirement_index}"` : ''}>
      <span class="circle-btn red">🗑️</span>
    </button>`;

  // HTML
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
      <button class="btn-check"
              data-id="${act.id}"
              data-tipo="${act.tipo}"
              data-completado="${act.completado}"
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

  // Efectos
  if (startsSoon && !act.completado) actDiv.classList.add('latido');
  if (enCurso && !act.completado)    actDiv.classList.add('actividad-encurso');

  container.appendChild(actDiv);
});

// FIN del forEach de render

agregarEventos();
initDragAndDropTareas();


  agregarEventos();
  initDragAndDropTareas(); // activar drag & drop simple

}

function parseHHMM(str) {
  if (!str || !str.includes(':')) return null;
  const [h, m] = str.split(':').map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? { h, m } : null;
}
function fmtHHMM({h, m}) {
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function addMinutes({h, m}, add) {
  let tot = h*60 + m + add;
  tot = ((tot % (24*60)) + 24*60) % (24*60);
  return { h: Math.floor(tot/60), m: tot%60 };
}
function roundToNext15({h, m}) {
  const t = h*60 + m;
  const r = Math.ceil(t/15)*15;
  return { h: Math.floor(r/60), m: r%60 };
}
// Duración por defecto por tipo
function duracionPorDefecto(subtipo) {
  if (subtipo === 'requisito') return 15; // requisito = 15'
  if (subtipo === 'mejora')    return 25; // mejora   = 25'
  return 30;                              // tarea    = 30'
}

// DnD simple (sin rutinas): reordena y reasigna horas en secuencia
async function initDragAndDropTareas() {
  const list = document.getElementById('agenda-container');
  if (!list) return;

  let draggingEl = null;
  let veniaSinHora = false;             // 👈 guardamos estado original
  const ph = document.createElement('div');
  ph.className = 'drag-placeholder';

  list.querySelectorAll('.draggable-task').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      draggingEl = e.currentTarget;
      veniaSinHora = draggingEl.dataset.sinHora === '1';   // 👈
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingEl.dataset.id);
      setTimeout(() => draggingEl.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      draggingEl?.classList.remove('dragging');
      ph.remove();
      draggingEl = null;
      veniaSinHora = false;
    });
  });

  list.addEventListener('dragover', (e) => {
    if (!draggingEl) return;
    e.preventDefault();
    const after = getAfterElement(list, e.clientY);
    if (after == null) list.appendChild(ph);
    else list.insertBefore(ph, after);
  });

  list.addEventListener('drop', async (e) => {
    if (!draggingEl) return;
    e.preventDefault();
    const after = getAfterElement(list, e.clientY);
    if (after == null) list.appendChild(draggingEl);
    else list.insertBefore(draggingEl, after);
    ph.remove();

    if (veniaSinHora) {
      // 👇 Solo esta tarjeta recibe una hora nueva, no tocamos el resto
      await asignarHoraAlSoltar(draggingEl);
      mostrarToast('Hora asignada');
    } else {
      // 👇 Reprograma todas las tareas con hora en cascada (como antes)
      await reprogramarSecuencialSimple();
      mostrarToast('Hora actualizada');
    }
    cargarAgendaHoy(); // refresca todo
  });

  function getAfterElement(container, y) {
    const els = [...container.querySelectorAll('.draggable-task:not(.dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    els.forEach(child => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
    });
    return closest.element;
  }
}


/**
 * Reasigna horas en secuencia según el orden visual de .draggable-task
 * - Mantiene la duración existente si la hay; si no, usa duraciones por defecto.
 * - Punto de arranque: menor hora hallada; si ninguna, ahora redondeado a :00/:15/:30/:45.
 * - NO considera rutinas (versión simple para probar UX).
 */
async function reprogramarSecuencialSimple() {
  const cont = document.getElementById('agenda-container');
  const items = [...cont.querySelectorAll('.draggable-task')];

  // 1) Extraer tiempos y duraciones
  const data = items.map(el => {
    const id = el.dataset.id;
    const subtipo = el.dataset.subtipo;
    const txt = el.querySelector('.actividad-hora')?.textContent || '';
    const m = txt.match(/(\d{2}:\d{2})(?:\s*-\s*(\d{2}:\d{2}))?/);
    let start = null, end = null, durMin = duracionPorDefecto(subtipo);
    if (m) {
      start = parseHHMM(m[1]);
      if (m[2]) end = parseHHMM(m[2]);
      if (start && end) {
        durMin = Math.max(5, (end.h*60+end.m) - (start.h*60+start.m));
      }
    }
    return { id, subtipo, start, end, durMin };
  });

  // 2) Base de inicio
  let base = null;
  for (const t of data) if (t.start) {
    if (!base) base = t.start;
    else {
      const cur = t.start.h*60 + t.start.m;
      const bas = base.h*60 + base.m;
      if (cur < bas) base = t.start;
    }
  }
  if (!base) {
    const now = new Date();
    base = roundToNext15({ h: now.getHours(), m: now.getMinutes() });
  }

  // 3) Reasignar en cascada
  let cursor = { ...base };
  for (const t of data) {
    const newStart = { ...cursor };
    const newEnd = addMinutes(newStart, t.durMin);
    cursor = { ...newEnd };
    await supabase
      .from('tasks')
      .update({ start_time: fmtHHMM(newStart), end_time: fmtHHMM(newEnd) })
      .eq('id', t.id);
  }
}

// Toast ultra simple
function mostrarToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast-sys';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); t.remove(); }, 1800);
}


function agregarEventos() {
  // Completar tarea (sync mejora y/o cita)
  document.querySelectorAll('.btn-check').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const btnEl = e.currentTarget;
      if (!btnEl) return;

      const { id, tipo, completado, aid, idx, improvementId } = {
        id: btnEl.dataset.id,
        tipo: btnEl.dataset.tipo,
        completado: btnEl.dataset.completado,
        aid: btnEl.dataset.aid,
        idx: btnEl.dataset.idx,
        improvementId: btnEl.dataset.improvementId
      };

      const actual = completado === 'true';
      const nuevoEstado = !actual;

      if (tipo === 'Tarea') {
        // 1) Marcar la tarea
        const { error } = await supabase
          .from('tasks')
          .update({ is_completed: nuevoEstado })
          .eq('id', id);
        if (error) {
          console.error('❌ Error completando tarea:', error);
          return;
        }

        // 2) Si es mejora, actualizar last_done_at cuando se completa
        if (improvementId && nuevoEstado === true) {
          const hoyStr = new Date().toISOString().split('T')[0];
          const { error: updMejErr } = await supabase
            .from('mejoras')
            .update({ last_done_at: hoyStr })
            .eq('id', improvementId);
          if (updMejErr) console.warn('⚠️ No se pudo actualizar last_done_at:', updMejErr);
        }

        // 3) Si está vinculada a cita, sincronizar requisito
        const idxNum = Number.isFinite(Number(idx)) ? Number(idx) : null;
        if (aid && Number.isInteger(idxNum)) {
          const { data: appt, error: err1 } = await supabase
            .from('appointments')
            .select('requirements')
            .eq('id', aid)
            .single();

          if (!err1 && appt && Array.isArray(appt.requirements)) {
            const reqs = appt.requirements.map(r =>
              typeof r === 'string'
                ? { text: r, checked: false }
                : { text: r?.text || '', checked: !!r?.checked }
            );

            if (reqs[idxNum]) reqs[idxNum].checked = nuevoEstado;

            const { error: err2 } = await supabase
              .from('appointments')
              .update({ requirements: reqs })
              .eq('id', aid);
            if (err2) console.error('❌ Error sync cita desde tarea:', err2);

            window.dispatchEvent(new CustomEvent('requisito-actualizado', {
              detail: { citaId: aid, index: idxNum, checked: nuevoEstado }
            }));
          }
        }

        cargarAgendaHoy();
      }
    });
  });

  // Borrar actividad (rutina o tarea normal; las de requisito no muestran botón)
  document.querySelectorAll('.btn-borrar').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const btnEl = e.currentTarget;
      if (!btnEl) return;

      const { id, tipo } = btnEl.dataset;

      if (tipo !== 'Tarea') {
        const { error: delRutErr } = await supabase.from('routines').delete().eq('id', id);
        if (delRutErr) console.error('❌ Error al borrar rutina:', delRutErr);
        cargarAgendaHoy();
        return;
      }

      // 1) Leer la tarea (por si fuera de mejora, para posibles acciones futuras)
      const { data: task, error: taskErr } = await supabase
        .from('tasks')
        .select('appointment_id, requirement_index, improvement_id')
        .eq('id', id)
        .single();

      if (taskErr) {
        console.error('❌ No se pudo leer la tarea antes de borrar:', taskErr);
        return;
      }

      // 2) Borrar por id
      const { error: delErr } = await supabase.from('tasks').delete().eq('id', id);
      if (delErr) {
        console.error('❌ Error al borrar tarea:', delErr);
        return;
      }

      // 3) Si era requisito de cita, desmarcar en la cita
      const aid = task?.appointment_id;
      const idxNum = Number.isFinite(Number(task?.requirement_index)) ? Number(task.requirement_index) : null;

      if (aid && Number.isInteger(idxNum)) {
        const { data: appt, error: apptErr } = await supabase
          .from('appointments')
          .select('requirements')
          .eq('id', aid)
          .single();

        if (!apptErr && appt && Array.isArray(appt.requirements)) {
          const reqs = appt.requirements.map(r =>
            typeof r === 'string'
              ? { text: r, checked: false }
              : { text: r?.text || '', checked: !!r?.checked }
          );
          if (reqs[idxNum]) reqs[idxNum].checked = false;

          const { error: updErr } = await supabase
            .from('appointments')
            .update({ requirements: reqs })
            .eq('id', aid);

          if (!updErr) {
            window.dispatchEvent(new CustomEvent('requisito-actualizado', {
              detail: { citaId: aid, index: idxNum, checked: false }
            }));
          }
        }
      }

      cargarAgendaHoy();
    });
  });

  // Editar actividad (tareas/rutinas)
  document.querySelectorAll('.btn-editar').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const tipo = e.currentTarget.dataset.tipo;

      const { data, error } = await supabase
        .from(tipo === 'Tarea' ? 'tasks' : 'routines')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        console.error("No se pudo obtener la actividad:", error);
        return;
      }

      const formContainer = document.createElement('div');
      formContainer.classList.add('form-overlay');
      formContainer.innerHTML = `
        <form class="formulario-edicion">
          <h3>Editar ${tipo}</h3>
          <label>Descripción:
            <input type="text" name="descripcion" value="${data.description}" required>
          </label>
          <label>Hora inicio:
            <input type="time" name="start" value="${data.start_time || ''}">
          </label>
          <label>Hora fin:
            <input type="time" name="end" value="${data.end_time || ''}">
          </label>
          <div class="form-botones">
            <button type="submit">Guardar</button>
            <button type="button" id="cancelarEdicion">Cancelar</button>
          </div>
        </form>
      `;
      document.body.appendChild(formContainer);
      formContainer.querySelector('#cancelarEdicion').onclick = () => formContainer.remove();

      formContainer.querySelector('form').onsubmit = async (ev) => {
        ev.preventDefault();
        const nuevaDescripcion = ev.target.descripcion.value;
        const nuevaHoraInicio = ev.target.start.value;
        const nuevaHoraFin = ev.target.end.value;

        const { error: errorUpdate } = await supabase
          .from(tipo === 'Tarea' ? 'tasks' : 'routines')
          .update({
            description: nuevaDescripcion,
            start_time: nuevaHoraInicio || null,
            end_time: nuevaHoraFin || null
          })
          .eq('id', id);

        if (errorUpdate) {
          console.error("Error al actualizar:", errorUpdate);
        } else {
          formContainer.remove();
          cargarAgendaHoy();
        }
      };
    });
  });
}

cargarAgendaHoy();
window.cargarAgendaHoy = cargarAgendaHoy;

// Refrescos ante eventos externos (citas)
window.addEventListener('requisito-actualizado', () => {
  cargarAgendaHoy();
});
window.addEventListener('cita-borrada', () => {
  cargarAgendaHoy();
});



/**
 * Da hora a un ítem que antes no tenía hora, en su nueva posición:
 * - intenta ponerla justo DESPUÉS del fin del elemento anterior con hora;
 * - si el anterior no tiene fin/hora, usa "ahora" redondeado a 15';
 * - NO toca al resto.
 */
async function asignarHoraAlSoltar(el) {
  const subtipo = el.dataset.subtipo || 'tarea';
  const dur = duracionPorDefecto(subtipo);

  // 1) Busca el hermano anterior con hora válida
  let prev = el.previousElementSibling;
  let prevEnd = null;
  while (prev) {
    if (prev.classList?.contains('actividad-item')) {
      const horaTxt = prev.querySelector('.actividad-hora')?.textContent || '';
      const m = horaTxt.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (m) { prevEnd = parseHHMM(m[2]); break; }
      const sOnly = horaTxt.match(/^(\d{2}:\d{2})$/);
      if (sOnly) { prevEnd = addMinutes(parseHHMM(sOnly[1]), dur); break; }
    }
    prev = prev.previousElementSibling;
  }

  // 2) Punto de partida
  let start = null;
  if (prevEnd) {
    start = prevEnd;
  } else {
    const now = new Date();
    start = roundToNext15({ h: now.getHours(), m: now.getMinutes() });
  }
  const end = addMinutes(start, dur);

  // 3) Guarda en DB y marca que ya tiene hora
  await supabase
    .from('tasks')
    .update({ start_time: fmtHHMM(start), end_time: fmtHHMM(end) })
    .eq('id', el.dataset.id);

  el.dataset.sinHora = '0';
}
