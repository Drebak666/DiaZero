import { supabase } from './supabaseClient.js';
import { getUsuarioActivo } from './usuario.js';


const container = document.getElementById('citas-container');
const formEditar = document.getElementById('form-editar-cita');
const editarFormulario = document.getElementById('editar-formulario');

const inputId = document.getElementById('editar-id');
const inputDescripcion = document.getElementById('editar-descripcion');
const inputFecha = document.getElementById('editar-fecha');
const inputInicio = document.getElementById('editar-hora-inicio');
const inputFin = document.getElementById('editar-hora-fin');

const nuevoRequisito = document.getElementById('nuevo-requisito');
const btnAñadirRequisito = document.getElementById('añadir-requisito');
const requisitosContainer = document.getElementById('requisitos-container');

const btnCancelarEdicion = document.getElementById('cancelar-edicion');

let citas = [];
let paginaActual = 1;
const citasPorPagina = 10;
let totalCitas = 0;

// Función para calcular tiempo restante en formato días, horas y minutos
function tiempoRestante(fechaStr, horaStr) {
    if (!fechaStr) return "Fecha no definida";

    // Attempt to create a Date object in local time using a space separator
    // This is generally more reliable for local time interpretation than 'T' without timezone info
    const dateTimeString = `${fechaStr} ${horaStr || '00:00'}:00`;
    let fechaCita = new Date(dateTimeString);

    // If initial parsing fails (e.g., browser doesn't like space or specific format)
    // try with 'T' (ISO format).
    if (isNaN(fechaCita.getTime())) {
        const isoDateTimeString = `${fechaStr}T${horaStr || '00:00'}:00`;
        fechaCita = new Date(isoDateTimeString);
    }
    
    // If still invalid, try just the date part
    if (isNaN(fechaCita.getTime())) {
        fechaCita = new Date(fechaStr);
        if (isNaN(fechaCita.getTime())) {
            return "Fecha inválida"; // Unable to parse any valid date
        }
        // If only date provided, set time to start of day to compare correctly
        fechaCita.setHours(0, 0, 0, 0);
    }

    let ahora = new Date(); // Get current date and time in local timezone

    let diffMs = fechaCita - ahora; // Difference in milliseconds

    if (diffMs <= 0) return "Ya pasó"; // Changed to "Ya pasó" as per your existing code

    let dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let horas = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    let minutos = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    // Handle cases where a component might be negative due to floor (e.g. -0 hours)
    if (dias < 0) dias = 0;
    if (horas < 0) horas = 0;
    if (minutos < 0) minutos = 0;

    // Return format as per all-appointments.js existing logic:
    if (dias >= 1) return `${dias} día${dias > 1 ? 's' : ''}`;
    if (horas >= 1) return `${horas} h ${minutos} min`;
    return `${minutos} min`;
}

async function toggleCompletado(id, estadoActual) {
    const { error } = await supabase
        .from('appointments')
        .update({ completed: !estadoActual })
        .eq('id', id);

    if (error) {
        alert("Error al actualizar el estado");
        console.error(error);
        return false;
    }
    return true;
}

async function borrarCita(id) {
    const confirmado = confirm("¿Seguro que quieres borrar esta cita?");
    if (!confirmado) return;

    const { error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', id);

    if (error) {
        alert("Error al borrar la cita");
        console.error(error);
        return;
    }
    cargarCitas(paginaActual);
}

// Modified editarCita function to include delete button for requirements
function editarCita(id) {
    const cita = citas.find(c => c.id == id);
    if (!cita) return alert('Cita no encontrada'); // Added alert for consistency

    inputId.value = cita.id;
    inputDescripcion.value = cita.description || '';
    inputFecha.value = cita.date || '';
    inputInicio.value = cita.startTime || '';
    inputFin.value = cita.endTime || '';

    requisitosContainer.innerHTML = '';
    if (Array.isArray(cita.requirements)) { // Ensure it's an array
        cita.requirements.forEach(req => {
            const label = document.createElement('label');
            label.className = 'req-item';
            label.style.display = 'flex'; // Added flex for layout
            label.style.alignItems = 'center';
            label.style.marginBottom = '5px';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true; // Checked by default when editing existing
            checkbox.value = req;
            checkbox.style.marginRight = '8px';

            const span = document.createElement('span');
            span.textContent = req;
            span.style.flexGrow = '1';

            const btnBorrar = document.createElement('button');
            btnBorrar.type = 'button';
            btnBorrar.textContent = '✖';
            btnBorrar.title = 'Borrar requisito';
            btnBorrar.style.marginLeft = '8px';
            btnBorrar.style.background = 'transparent';
            btnBorrar.style.border = 'none';
            btnBorrar.style.color = 'red';
            btnBorrar.style.cursor = 'pointer';
            btnBorrar.style.fontWeight = 'bold';

            btnBorrar.addEventListener('click', () => {
                label.remove(); // Removes the entire requirement line from the DOM
            });

            label.appendChild(checkbox);
            label.appendChild(span);
            label.appendChild(btnBorrar); // Add the delete button

            requisitosContainer.appendChild(label);
        });
    }

    formEditar.classList.remove('oculto');
    formEditar.scrollIntoView({ behavior: 'smooth' });
}

if (btnCancelarEdicion) {
    btnCancelarEdicion.addEventListener('click', () => {
        formEditar.classList.add('oculto');
    });
}

if (editarFormulario) {
    editarFormulario.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = inputId.value;
        const nuevosRequisitos = Array.from(requisitosContainer.querySelectorAll('input[type="checkbox"]'))
            .filter(cb => cb.checked) // Only include checked checkboxes
            .map(cb => cb.value);

        const { error } = await supabase
            .from('appointments')
            .update({
                description: inputDescripcion.value,
                date: inputFecha.value,
                startTime: inputInicio.value,
                endTime: inputFin.value,
                requirements: nuevosRequisitos
            })
            .eq('id', id);

        if (error) {
            alert('Error al actualizar la cita');
            console.error(error);
            return;
        }

        formEditar.classList.add('oculto');
        cargarCitas(paginaActual);
    });
}

if (btnAñadirRequisito) {
    btnAñadirRequisito.addEventListener('click', () => {
        const texto = nuevoRequisito.value.trim();
        if (!texto) return;

        const label = document.createElement('label');
        label.classList.add('req-item');
        label.style.display = 'flex'; // Added flex for layout
        label.style.alignItems = 'center';
        label.style.marginBottom = '5px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.value = texto;
        checkbox.style.marginRight = '8px';

        const span = document.createElement('span');
        span.textContent = texto;
        span.style.flexGrow = '1';

        const btnBorrar = document.createElement('button');
        btnBorrar.type = 'button';
        btnBorrar.textContent = '✖';
        btnBorrar.title = 'Borrar requisito';
        btnBorrar.style.marginLeft = '8px';
        btnBorrar.style.background = 'transparent';
        btnBorrar.style.border = 'none';
        btnBorrar.style.color = 'red';
        btnBorrar.style.cursor = 'pointer';
        btnBorrar.style.fontWeight = 'bold';

        btnBorrar.addEventListener('click', () => {
            label.remove();
        });

        label.appendChild(checkbox);
        label.appendChild(span);
        label.appendChild(btnBorrar);

        requisitosContainer.appendChild(label);
        nuevoRequisito.value = '';
    });
}

async function cargarTotalCitas() {
    const { count, error } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('Error al contar citas:', error);
        return 0;
    }
    return count || 0;
}

async function cargarCitas(pagina = 1) {
    paginaActual = pagina;
    const usuario = getUsuarioActivo();


    const desde = (paginaActual - 1) * citasPorPagina;

    const usuario = getUsuarioActivo();
    const { data, error, count } = await supabase
  .from('appointments')
  .select('*', { count: 'exact' })
  .eq('usuario', usuario) // ✅ FILTRO AÑADIDO AQUÍ
  .order('date', { ascending: true })
  .range(desde, desde + citasPorPagina - 1);

    if (error) {
        container.innerHTML = '<p>Error al cargar las citas.</p>';
        console.error(error);
        return;
    }

    citas = data;
    totalCitas = count;
    mostrarCitas();
}

function mostrarCitas() {
    container.innerHTML = '';

    if (citas.length === 0) {
        container.innerHTML = '<p>No hay citas para mostrar.</p>';
        return;
    }

    citas.forEach(cita => {
        const div = document.createElement('div');
        div.className = 'cita';

        const estadoTexto = cita.completed ? 'Completado' : 'Pendiente';
        const estadoClase = cita.completed ? 'completado' : 'pendiente';
        const tiempo = tiempoRestante(cita.date, cita.startTime);

        div.innerHTML = `
            <strong>${cita.description || 'Sin descripción'}</strong><br>
            📅 ${new Date(cita.date).toLocaleDateString('es-ES')} 🕒 ${cita.startTime || 'Hora no disponible'}<br>
            ⏳ Tiempo restante: <em>${tiempo}</em><br>
            <button class="btn-estado ${estadoClase}" data-id="${cita.id}">${estadoTexto}</button>
            <button class="btn-editar" data-id="${cita.id}">Editar</button>
            <button class="btn-borrar" data-id="${cita.id}">Borrar</button>
        `;
        
        // Add requirements with toggle similar to upcoming-appointments.js
        if (Array.isArray(cita.requirements) && cita.requirements.length > 0) {
            const requisitosWrapper = document.createElement('div');
            requisitosWrapper.className = 'requisitos-wrapper';
            requisitosWrapper.style.marginTop = '8px';

            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn-toggle-requisitos';
            toggleBtn.innerHTML = 'Mostrar requisitos <span class="clip-icon">📎</span>'; // Clip icon
            toggleBtn.style.background = 'none';
            toggleBtn.style.border = '1px solid #ccc';
            toggleBtn.style.padding = '5px 10px';
            toggleBtn.style.borderRadius = '5px';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.style.marginBottom = '5px';
            toggleBtn.style.display = 'block';

            const requisitosListDiv = document.createElement('div');
            requisitosListDiv.className = 'requisitos-lista oculto'; // Initially hidden
            requisitosListDiv.style.marginTop = '8px';

            cita.requirements.forEach((req, idx) => {
                const label = document.createElement('label');
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.marginBottom = '3px';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = false; // Initially unchecked for display
                checkbox.style.marginRight = '8px';

                const span = document.createElement('span');
                span.textContent = req;
                span.style.flexGrow = '1';

                const btnMarkCompletedReq = document.createElement('button');
                btnMarkCompletedReq.type = 'button';
                btnMarkCompletedReq.textContent = '✅';
                btnMarkCompletedReq.title = 'Marcar requisito como completado';
                btnMarkCompletedReq.style.marginLeft = '8px';
                btnMarkCompletedReq.style.background = 'transparent';
                btnMarkCompletedReq.style.border = 'none';
                btnMarkCompletedReq.style.cursor = 'pointer';
                btnMarkCompletedReq.style.fontSize = '1.1em';

                btnMarkCompletedReq.addEventListener('click', () => {
                    span.style.textDecoration = 'line-through';
                    checkbox.checked = true;
                    btnMarkCompletedReq.disabled = true;
                });

                const btnDeleteReq = document.createElement('button');
                btnDeleteReq.type = 'button';
                btnDeleteReq.textContent = '✖';
                btnDeleteReq.title = 'Borrar requisito';
                btnDeleteReq.style.marginLeft = '8px';
                btnDeleteReq.style.background = 'transparent';
                btnDeleteReq.style.border = 'none';
                btnDeleteReq.style.color = 'red';
                btnDeleteReq.style.cursor = 'pointer';
                btnDeleteReq.style.fontWeight = 'bold';

                btnDeleteReq.addEventListener('click', async () => {
                    if (confirm('¿Seguro que quieres borrar este requisito?')) {
                        const nuevosReqs = cita.requirements.filter(r => r !== req);
                        const { error } = await supabase
                            .from('appointments')
                            .update({ requirements: nuevosReqs })
                            .eq('id', cita.id);
                        if (error) {
                            alert('Error al actualizar requisitos');
                            console.error(error);
                        } else {
                            cita.requirements = nuevosReqs;
                            mostrarCitas(); // Re-render to reflect changes
                        }
                    }
                });

                label.appendChild(checkbox);
                label.appendChild(span);
                label.appendChild(btnMarkCompletedReq);
                label.appendChild(btnDeleteReq);

                requisitosListDiv.appendChild(label);
            });

            toggleBtn.addEventListener('click', () => {
                requisitosListDiv.classList.toggle('oculto');
                if (requisitosListDiv.classList.contains('oculto')) {
                    toggleBtn.innerHTML = 'Mostrar requisitos <span class="clip-icon">📎</span>';
                } else {
                    toggleBtn.innerHTML = 'Ocultar requisitos <span class="clip-icon">▼</span>';
                }
            });

            requisitosWrapper.appendChild(toggleBtn);
            requisitosWrapper.appendChild(requisitosListDiv);
            div.appendChild(requisitosWrapper);
        }

        container.appendChild(div);
    });

    // Eventos botones
    container.querySelectorAll('.btn-estado').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            const cita = citas.find(c => c.id == id);
            if (!cita) return;

            const exito = await toggleCompletado(id, cita.completed);
            if (exito) cargarCitas(paginaActual);
        });
    });

    container.querySelectorAll('.btn-borrar').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            borrarCita(id);
        });
    });

    container.querySelectorAll('.btn-editar').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            editarCita(id);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    cargarCitas(1);
});