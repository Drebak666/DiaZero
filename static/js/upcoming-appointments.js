import { supabase } from './supabaseClient.js';




/* ===========================
   Utils: normalización común
   =========================== */
export function normalizeRequirements(reqs) {
  if (!Array.isArray(reqs)) return [];
  return reqs.map(r => {
    if (typeof r === 'string') return { text: r, checked: false };
    const text = (r && typeof r.text === 'string') ? r.text : '';
    const checked = !!(r && r.checked);
    return { text, checked };
  });
}

async function esperarUsuarioActual() {
  return new Promise((resolve) => {
    const intervalo = setInterval(() => {
      const usuario = localStorage.getItem("usuario_actual");
      if (usuario) {
        clearInterval(intervalo);
        resolve(usuario);
      }
    }, 100);
  });
}

const container = document.getElementById('citas-container');
const formEditar = document.getElementById('form-editar-cita');
const editarFormulario = document.getElementById('editar-formulario');

const inputId = document.getElementById('editar-id');
const inputDescripcion = document.getElementById('editar-descripcion');
const inputFecha = document.getElementById('editar-fecha');
const inputInicio = document.getElementById('editar-hora-inicio');
const inputFin = document.getElementById('editar-hora-fin');

const requisitosContainer = document.getElementById('requisitos-container');
const nuevoRequisitoInput = document.getElementById('nuevo-requisito');
const btnAñadirRequisito = document.getElementById('añadir-requisito');
const btnRecogerEdicion = document.getElementById('recoger-edicion');
const btnVerMasCitas = document.getElementById('ver-mas-citas');

let citas = [];
let citasMostradas = 0;
const LIMITE_CITAS_INICIAL = 1;
const LIMITE_CITAS_ADICIONALES = 5;
let showingAllCitas = false;

// Modal
let messageModal;
let messageText;
let modalOkButton;
let closeButton;

let requisitosEdicion = [];

function showMessageModal(message) {
  messageModal = document.getElementById('message-modal');
  messageText = document.getElementById('message-text');
  modalOkButton = document.getElementById('modal-ok-button');
  closeButton = document.querySelector('.modal .close-button');

  if (!messageModal) {
    alert(message);
    return;
  }

  messageText.textContent = message;
  messageModal.classList.remove('oculto');

  const closeModal = () => {
    messageModal.classList.add('oculto');
    modalOkButton?.removeEventListener('click', closeModal);
    closeButton?.removeEventListener('click', closeModal);
  };

  modalOkButton?.addEventListener('click', closeModal);
  closeButton?.addEventListener('click', closeModal);
}

function formatFecha(fechaISO) {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const [año, mes, dia] = fechaISO.split('-');
  return `${parseInt(dia)} de ${meses[parseInt(mes) - 1]}`;
}

// === Helpers de grupos (UUID) ===
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
  return data.map(r => r.grupo_id);
}

/* ==========================================================
   Upsert de tareas de requisitos (por (appointment_id, idx))
   ========================================================== */
async function upsertRequirementTasks({ appointment, normalizedRequirements }) {
  const { data: { user } } = await supabase.auth.getUser();
  const usuarioActual = user?.id || localStorage.getItem('usuario_actual');
  const hoyStr = new Date().toISOString().split('T')[0];

  const rows = normalizedRequirements.map((req, idx) => ({
    usuario: usuarioActual,
    description: `${appointment.description} — ${req.text}`,
    due_date: hoyStr,
    is_completed: !!req.checked,
    appointment_id: appointment.id,
    requirement_index: idx,
    grupo_id: appointment.grupo_id || null // 👈 importante
  }));

  const { error } = await supabase
    .from('tasks')
    .upsert(rows, { onConflict: 'appointment_id,requirement_index' });

  if (error) console.error('❌ Error upsert tareas de requisitos:', error);
}


/* ===========================================
   Borrar tareas para requisitos eliminados
   =========================================== */
async function deleteRemovedRequirementTasks({ appointmentId, previousReqs, nextReqs }) {
  const prev = normalizeRequirements(previousReqs);
  const next = normalizeRequirements(nextReqs);

  // cualquier índice existente en prev que ya no exista en next → borrar
  const lastIndexNext = next.length - 1;
  const indicesToDelete = [];
  for (let i = 0; i < prev.length; i++) {
    if (i > lastIndexNext) indicesToDelete.push(i);
  }

  if (indicesToDelete.length === 0) return;

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('appointment_id', appointmentId)
    .in('requirement_index', indicesToDelete);

  if (error) {
    console.error('❌ Error borrando tareas de requisitos eliminados:', error);
  }
}

/* ===========================================
   Cargar + render de citas (filtra por UUID)
   =========================================== */
/* ===========================================
   Cargar + render de citas (usuario propio + grupos)
   =========================================== */
async function cargarCitas(showAll = false) {
  // 1) Identidad
  const { data: { user } } = await supabase.auth.getUser();
  const uid   = user?.id || null;               // UUID
  const email = user?.email || null;            // email (por compatibilidad)
  const stored = localStorage.getItem('usuario_actual') || null; // username si lo usas
  const who = [uid, email, stored].filter(Boolean);
  if (!who.length) { container.innerHTML = ''; return; }

  // 2) Grupos del usuario
  const grupos = await gruposIdsDelUsuarioActual();

  // 3) Construir OR: usuario IN (uid/email/username) OR grupo_id IN (mis grupos)
  const usuarioClauses = who.map(v => `usuario.eq.${v}`).join(',');
  const orFiltro = grupos.length
    ? (usuarioClauses ? `${usuarioClauses},grupo_id.in.(${grupos.join(',')})`
                      : `grupo_id.in.(${grupos.join(',')})`)
    : (usuarioClauses || 'usuario.eq.__none__');

  // 4) Query
  let q = supabase
    .from('appointments')
    .select('id, description, date, start_time, end_time, completed, requirements, usuario, grupo_id')
    .order('completed', { ascending: true })
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });

  q = q.or(orFiltro);

  const { data, error } = await q;
  if (error) {
    console.error('Error al cargar citas desde Supabase:', error);
    showMessageModal(`Error al cargar citas: ${error.message}`);
    return;
  }

  // 5) Normaliza requisitos
  citas = (data || []).map(c => ({
    ...c,
    requirements: normalizeRequirements(c.requirements)
  }));

  // 6) Pinta
  renderCitas(showAll);
}
window.cargarCitas = cargarCitas;


function renderCitas(showAll) {
  container.innerHTML = '';
  citasMostradas = 0;

  if (citas.length === 0) {
    container.innerHTML = '<p class="no-citas-msg">No hay citas programadas.</p>';
    btnVerMasCitas?.classList.add('oculto');
    return;
  }

  // Mostrar todas o solo el primer día
  let citasToShow = [];
  if (showAll) {
    citasToShow = citas;
  } else {
    const primeraFecha = citas[0]?.date;
    citasToShow = citas.filter(c => c.date === primeraFecha);
  }

  for (let i = 0; i < citasToShow.length; i++) {
    const cita = citasToShow[i];
    const citaDiv = document.createElement('div');
    citaDiv.classList.add('cita-item');
    if (cita.completed) citaDiv.classList.add('completed-cita-item');

    // tiempo restante
    // tiempo restante + flags de urgencia
let tiempoRestante = '';
let urgente = false; // < 24h
let critica = false; // < 1h

if (!cita.completed && cita.date && cita.start_time) {
  const [year, month, day] = cita.date.split('-').map(Number);
  const [hours, minutes] = cita.start_time.split(':').map(Number);
  const fechaCita = new Date(year, month - 1, day, hours, minutes);
  const ahora = new Date();

  const diffMs = fechaCita - ahora;

  if (diffMs > 0) {
    urgente = diffMs <= 24 * 60 * 60 * 1000; // 24h
    critica = diffMs <= 60 * 60 * 1000;      // 1h

    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffDays > 0) {
      tiempoRestante = `Faltan ${diffDays}d ${diffHours}h`;
    } else if (diffHours > 0) {
      tiempoRestante = `Faltan ${diffHours}h ${diffMinutes}m`;
    } else {
      tiempoRestante = `Faltan ${diffMinutes}m`;
    }
  } else {
    tiempoRestante = 'Pasada';
  }
} else if (cita.completed) {
  tiempoRestante = 'Completada';
}

if (urgente) citaDiv.classList.add('urgente');
if (critica) citaDiv.classList.add('critica');

   citaDiv.innerHTML = `
<div class="cita-main-content ${urgente ? 'urgente' : ''} ${critica ? 'critica' : ''}">
  <i class="estado-icono"></i>
  <span class="cita-descripcion">${cita.description}</span>
  <span class="cita-hora">${cita.start_time || ''}${cita.end_time ? ' - ' + cita.end_time : ''}</span>
  <span class="cita-tiempo-restante ${urgente ? 'urgente' : ''} ${critica ? 'critica' : ''}">
    ${tiempoRestante}
  </span>

  ${
    (Array.isArray(cita.requirements) && cita.requirements.length > 0)
      ? `
      <details class="requisitos-accordion cita-req-accordion">
        <summary>Requisitos</summary>
        <div class="cita-requisitos">
          ${cita.requirements.map((req, reqIndex) => `
            <label class="requisito-checkbox">
              <input type="checkbox"
                     data-aid="${cita.id}"
                     data-idx="${reqIndex}"
                     ${req.checked ? 'checked' : ''} />
              <span>${req.text}</span>
            </label>
          `).join('')}
        </div>
      </details>
    ` : ''
  }
</div>

<div class="cita-aside-content ${urgente ? 'urgente' : ''} ${critica ? 'critica' : ''}">
  <div class="cita-fecha">${formatFecha(cita.date)}</div>
  <div class="cita-actions">
    <button class="btn-action btn-complete ${cita.completed ? 'completed' : ''}" data-id="${cita.id}" data-completed="${cita.completed}">
      <i class="fas fa-check"></i>
    </button>
    <button class="btn-action btn-edit" data-id="${cita.id}">
      <i class="fas fa-edit"></i>
    </button>
    <button class="btn-action btn-delete" data-id="${cita.id}">
      <i class="fas fa-trash"></i>
    </button>
    <button class="btn-action btn-register" data-id="${cita.id}" title="Guardar como registro">
      <i class="fas fa-bookmark"></i>
    </button>
  </div>
</div>
`;

    container.appendChild(citaDiv);
    citasMostradas++;
  }

  if (citas.length > LIMITE_CITAS_INICIAL) {
    btnVerMasCitas?.classList.remove('oculto');
    btnVerMasCitas.textContent = showAll
      ? 'Recoger citas'
      : `Ver ${Math.min(LIMITE_CITAS_ADICIONALES, citas.length - LIMITE_CITAS_INICIAL)} citas más`;
  } else {
    btnVerMasCitas?.classList.add('oculto');
  }

  // Listeners
  document.querySelectorAll('.btn-complete').forEach(button => {
    button.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const completed = e.currentTarget.dataset.completed === 'true';
      toggleCompletado(id, !completed);
    });
  });

  document.querySelectorAll('.btn-edit').forEach(button => {
    button.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      editarCita(id);
    });
  });

  document.querySelectorAll('.btn-delete').forEach(button => {
    button.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      await borrarCita(id);
    });
  });

  // Checkboxes de requisitos (sync → tasks)
  document.querySelectorAll('.cita-requisitos input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      const aid = e.target.dataset.aid;
      const idx = parseInt(e.target.dataset.idx);
      const checked = e.target.checked;

      const cita = citas.find(c => c.id == aid);
      if (!cita || !Array.isArray(cita.requirements)) return;

      // 1) Actualiza cita.requirements[idx].checked
      const updatedReqs = [...cita.requirements];
      updatedReqs[idx] = { ...updatedReqs[idx], checked };

      const { error: err1 } = await supabase
        .from('appointments')
        .update({ requirements: updatedReqs })
        .eq('id', aid);
      if (err1) {
        console.error('❌ Error al guardar requisito:', err1);
        showMessageModal('No se pudo guardar el cambio en el requisito.');
        return;
      }

      // 2) Sincroniza la tarea correspondiente
      const { error: err2 } = await supabase
        .from('tasks')
        .update({ is_completed: checked })
        .eq('appointment_id', aid)
        .eq('requirement_index', idx);
      if (err2) console.error('❌ Error sync tarea requisito:', err2);

      // 3) Refresca citas manteniendo estado y emite evento global
      await cargarCitas(showingAllCitas);
      window.dispatchEvent(new CustomEvent('requisito-actualizado', {
        detail: { citaId: aid, index: idx, checked }
      }));
    });
  });
}

/* ===========================================
   Edición de cita (con normalización + upsert)
   =========================================== */
async function editarCita(id) {
  // Plegar si ya estaba abierta para la misma
  if (!formEditar.classList.contains('oculto') && inputId.value == id) {
    formEditar.classList.add('oculto');
    return;
  }

  const cita = citas.find(c => c.id == id);
  if (!cita) {
    showMessageModal('Cita no encontrada.');
    return;
  }

  inputId.value = cita.id;
  inputDescripcion.value = cita.description || '';
  inputFecha.value = cita.date || '';
  inputInicio.value = cita.start_time || '';
  inputFin.value = cita.end_time || '';

  requisitosEdicion = normalizeRequirements(cita.requirements || []);
  renderRequisitosEdicion();
  formEditar.classList.remove('oculto');
}

function renderRequisitosEdicion() {
  requisitosContainer.innerHTML = '';
  requisitosEdicion.forEach((req, index) => {
    const reqItem = document.createElement('div');
    reqItem.classList.add('requirement-item');
    reqItem.innerHTML = `
      <span>${req.text}</span>
      <button type="button" class="delete-requirement" data-index="${index}">&times;</button>
    `;
    requisitosContainer.appendChild(reqItem);
  });

  requisitosContainer.querySelectorAll('.delete-requirement').forEach(button => {
    button.addEventListener('click', (e) => {
      const index = e.target.dataset.index;
      requisitosEdicion.splice(index, 1);
      renderRequisitosEdicion();
    });
  });
}

btnAñadirRequisito?.addEventListener('click', () => {
  const nuevoReq = (nuevoRequisitoInput?.value || '').trim();
  if (nuevoReq) {
    requisitosEdicion.push({ text: nuevoReq, checked: false });
    renderRequisitosEdicion();
    nuevoRequisitoInput.value = '';
  }
});

btnRecogerEdicion?.addEventListener('click', () => {
  formEditar.classList.add('oculto');
});

/* ===========================================
   Guardar (submit) edición de cita
   - Normaliza requisitos al guardar
   - Upsert tareas
   - Borra tareas de requisitos eliminados
   =========================================== */
editarFormulario?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = inputId.value;
  const updatedDescription = inputDescripcion.value.trim();
  const updatedDate = inputFecha.value;
  const updatedStartTime = inputInicio.value || null;
  const updatedEndTime = inputFin.value || null;

  if (!updatedDescription || !updatedDate) {
    showMessageModal('La descripción y la fecha son obligatorias.');
    return;
  }

  // Obtener requisitos ANTERIORES desde DB para comparación
  const { data: prevRow, error: prevErr } = await supabase
    .from('appointments')
    .select('id, description, requirements')
    .eq('id', id)
    .single();
  if (prevErr) {
    console.error('❌ No se pudo leer la cita previa:', prevErr);
    showMessageModal('No se pudo leer la cita previa.');
    return;
  }
  const prevReqs = normalizeRequirements(prevRow?.requirements || []);

  // Normaliza los nuevos
  const normalizedReqs = normalizeRequirements(requisitosEdicion);

  // Actualiza cita
  const { data, error } = await supabase
    .from('appointments')
    .update({
      description: updatedDescription,
      date: updatedDate,
      start_time: updatedStartTime,
      end_time: updatedEndTime,
      requirements: normalizedReqs   // guardar SIEMPRE normalizado
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error al actualizar cita:', error);
    showMessageModal(`Error al actualizar cita: ${error.message}`);
    return;
  }

  // Upsert de tareas de requisitos (SIEMPRE hoy, texto con prefijo [Cita])
await upsertRequirementTasks({
  appointment: { id, description: updatedDescription, grupo_id: data?.grupo_id || null },
  normalizedRequirements: normalizedReqs
});

  // Borrar las tareas de requisitos eliminados
  await deleteRemovedRequirementTasks({
    appointmentId: id,
    previousReqs: prevReqs,
    nextReqs: normalizedReqs
  });

  formEditar.classList.add('oculto');
  await cargarCitas(showingAllCitas);
});

/* ===========================================
   Completar cita
   =========================================== */
async function toggleCompletado(id, completedStatus) {
  const { error } = await supabase
    .from('appointments')
    .update({ completed: completedStatus })
    .eq('id', id);

  if (error) {
    console.error(error);
    showMessageModal(`Error al cambiar estado: ${error.message}`);
    return;
  }
  cargarCitas(showingAllCitas);
}

/* ===========================================
   Borrar cita (+ borrar tareas vinculadas)
   =========================================== */
async function borrarCita(id) {
  // 1) borra tareas vinculadas
  const { error: taskErr } = await supabase
    .from('tasks')
    .delete()
    .eq('appointment_id', id);
  if (taskErr) console.error('⚠️ Error borrando tareas de la cita:', taskErr);

  // 🔔 avisa al resto de módulos (Agenda de hoy) para repintar sin F5
  window.dispatchEvent(new CustomEvent('cita-borrada', {
    detail: { citaId: id }
  }));

  // 2) borra cita
  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id);

  if (error) {
    console.error(error);
    showMessageModal(`Error al borrar cita: ${error.message}`);
    return;
  }

  // 3) refresca el widget de citas
  cargarCitas(showingAllCitas);
}


document.addEventListener('DOMContentLoaded', async () => {
  const usuario = await esperarUsuarioActual();
  if (!usuario) {
    console.warn("⚠️ No se encontró el usuario en localStorage. No se cargarán citas.");
    return;
  }

  cargarCitas();

  btnVerMasCitas?.addEventListener('click', () => {
    showingAllCitas = !showingAllCitas;
    cargarCitas(showingAllCitas);
  });
});

// Guardar como registro (sin cambios funcionales)
document.addEventListener('click', async (e) => {
  if (e.target.closest('.btn-register')) {
    const id = e.target.closest('.btn-register').dataset.id;
    const cita = citas.find(c => c.id == id);

    if (!cita) {
      showMessageModal("No se encontró la cita.");
      return;
    }

   const { data: { user } } = await supabase.auth.getUser();
const { error } = await supabase.from('registros').insert({
  usuario: user?.id, // UUID
  nombre: cita.description || '',
  descripcion: (cita.requirements || []).map(r => r.text).join(', ') || '',
  fecha: cita.date,
  tipo: 'Cita',
  archivo_url: null
});


    if (error) {
      console.error('Error al registrar cita:', error);
      showMessageModal("No se pudo registrar la cita.");
    } else {
      showMessageModal("✅ Cita guardada como registro.");
    }
  }
});

// Refrescar Citas cuando otro módulo sincroniza un requisito
window.addEventListener('requisito-actualizado', () => {
  cargarCitas(showingAllCitas);
});
