// calendario.js

import { supabase } from "./supabaseClient.js";
import { getUsuarioActivo } from './usuario.js';


const calendarioGrid = document.getElementById("calendario-grid");
const mesSelect = document.getElementById("mes-select");
const añoSelect = document.getElementById("año-select");
const prevBtn = document.getElementById("prev-mes");
const nextBtn = document.getElementById("next-mes");
const actividadesLista = document.getElementById("lista-actividades");
const fechaSeleccionadaSpan = document.getElementById("fecha-seleccionada");

const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

let fechaActual = new Date();
let mesActual = fechaActual.getMonth();
let añoActual = fechaActual.getFullYear();
let actividadesPorFecha = {}; // Objeto para almacenar actividades agrupadas por fecha
let diaSeleccionado = null;

function poblarSelects() {
  meses.forEach((mes, i) => {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = mes;
    if (i === mesActual) option.selected = true;
    mesSelect.appendChild(option);
  });

  for (let a = añoActual - 5; a <= añoActual + 5; a++) {
    const option = document.createElement("option");
    option.value = a;
    option.textContent = a;
    if (a === añoActual) option.selected = true;
    añoSelect.appendChild(option);
  }
}

async function cargarActividades() {
  actividadesPorFecha = {}; // Limpiar actividades previas
    const usuario = getUsuarioActivo();

  const pad = (n) => n.toString().padStart(2, "0");

  const inicioMes = `${añoActual}-${pad(mesActual + 1)}-01`;
  const finDia = new Date(añoActual, mesActual + 1, 0).getDate();
  const finMes = `${añoActual}-${pad(mesActual + 1)}-${pad(finDia)}`;

  // Cargar citas
const { data: citas, error: errorCitas } = await supabase
  .from("appointments")
  .select("id, description, date, start_time")
  .gte("date", inicioMes)
  .lte("date", finMes)
  .eq("usuario", usuario); // ✅ Filtro añadido


  if (!errorCitas && citas) {
    citas.forEach((cita) => {
      const fecha = cita.date;
      if (!actividadesPorFecha[fecha]) actividadesPorFecha[fecha] = [];
      actividadesPorFecha[fecha].push({
  tipo: "CITA",
  descripcion: cita.description,
  hora: cita.start_time?.slice(0, 5) || null
});

    });
  }

  // Cargar rutinas
  const { data: rutinas, error: errorRutinas } = await supabase
  .from("routines")
  .select("id, description, days_of_week")
  .eq("usuario", usuario); // ✅ Filtro añadido


  if (!errorRutinas && rutinas) {
    rutinas.forEach((rutina) => {
      let diasSemana = rutina.days_of_week;
      if (typeof diasSemana === "string") diasSemana = JSON.parse(diasSemana);
      for (let dia = 1; dia <= new Date(añoActual, mesActual + 1, 0).getDate(); dia++) {
        const fecha = new Date(añoActual, mesActual, dia);
        const nombreDia = fecha.toLocaleDateString("es-ES", { weekday: "long" });
        const diaCapitalizado = nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1);
        if (diasSemana.includes(diaCapitalizado)) {
          const fechaStr = fecha.toISOString().split("T")[0];
          if (!actividadesPorFecha[fechaStr]) actividadesPorFecha[fechaStr] = [];
          actividadesPorFecha[fechaStr].push({ tipo: "RUTINA", descripcion: rutina.description });
        }
      }
    });
  }

  // Cargar tareas
  const { data: tareas, error: errorTareas } = await supabase
  .from("tasks")
  .select("id, description, due_date, start_time")
  .gte("due_date", inicioMes)
  .lte("due_date", finMes)
  .eq("usuario", usuario); // ✅ Filtro añadido


  if (!errorTareas && tareas) {
    tareas.forEach((tarea) => {
      const fecha = tarea.due_date;
      if (!actividadesPorFecha[fecha]) actividadesPorFecha[fecha] = [];
      actividadesPorFecha[fecha].push({
  tipo: "TAREA",
  descripcion: tarea.description,
  hora: tarea.start_time?.slice(0, 5) || null
});

    });
  }
}

function renderizarCalendario() {
  calendarioGrid.innerHTML = "";
  const primerDia = new Date(añoActual, mesActual, 1);
  const ultimoDia = new Date(añoActual, mesActual + 1, 0);
  const primerDiaSemana = primerDia.getDay() === 0 ? 6 : primerDia.getDay() - 1; // Ajustar para Lunes como primer día

  for (let i = 0; i < primerDiaSemana; i++) {
    const celdaVacia = document.createElement("div");
    calendarioGrid.appendChild(celdaVacia);
  }

  for (let dia = 1; dia <= ultimoDia.getDate(); dia++) {
    const fecha = new Date(añoActual, mesActual, dia);
    // CRITICAL CHANGE: Construct fechaStr using local date components to avoid timezone issues
    const year = fecha.getFullYear();
    const month = (fecha.getMonth() + 1).toString().padStart(2, '0'); // Month is 0-indexed, add 1 and pad
    const day = fecha.getDate().toString().padStart(2, '0'); // Pad day
    const fechaStr = `${year}-${month}-${day}`;

    const divDia = document.createElement("div");
    divDia.classList.add("dia-calendario");
    divDia.textContent = dia;
    // Eliminar todas las clases de actividad antes de aplicar las nuevas
    divDia.classList.remove("dia-tarea", "dia-cita", "dia-rutina");


    if (
      fecha.getDate() === new Date().getDate() &&
      fecha.getMonth() === new Date().getMonth() &&
      fecha.getFullYear() === new Date().getFullYear()
    ) {
      divDia.classList.add("dia-actual");
    }

    if (diaSeleccionado === fechaStr) {
      divDia.classList.add("dia-seleccionado");
    }

    if (actividadesPorFecha[fechaStr]) {
      const tipos = actividadesPorFecha[fechaStr].map((a) => a.tipo);

      // Aplicar clases para los indicadores visuales
      if (tipos.includes("TAREA")) {
        divDia.classList.add("dia-tarea"); // Esto debería aplicar el punto naranja
      }
      if (tipos.includes("CITA")) {
        divDia.classList.add("dia-cita"); // Esto debería aplicar el punto azul
      }
      if (tipos.includes("RUTINA")) {
        divDia.classList.add("dia-rutina"); // Si hay rutinas, también se marcarán
      }
    }

    divDia.addEventListener("click", () => seleccionarDia(fechaStr));
    calendarioGrid.appendChild(divDia);
  }
}

function seleccionarDia(fechaStr) {
  diaSeleccionado = fechaStr;
  // Parse the date string to avoid timezone issues
  const [year, month, day] = fechaStr.split('-').map(Number);
  const fecha = new Date(year, month - 1, day); // month - 1 because months are 0-indexed in JS Date

  const opciones = { year: "numeric", month: "long", day: "numeric" };
  fechaSeleccionadaSpan.textContent = fecha.toLocaleDateString("es-ES", opciones);
  actividadesLista.innerHTML = "";

  const actividades = actividadesPorFecha[fechaStr] || [];

  if (actividades.length === 0) {
    actividadesLista.innerHTML = "<li>No hay actividades para este día.</li>";
  } else {
const citas = actividades.filter((a) => a.tipo === "CITA");
const tareas = actividades.filter((a) => a.tipo === "TAREA");

if (citas.length > 0) {
  const hCitas = document.createElement("h4");
  hCitas.textContent = "CITAS";
  hCitas.style.color = "#29b6f6"; // azul claro
  actividadesLista.appendChild(hCitas);

  citas.forEach((act) => {
    const li = document.createElement("li");
    li.innerHTML = act.hora
  ? `<span class="hora">${act.hora}</span> - ${act.descripcion}`
  : act.descripcion;

    li.classList.add("tipo-CITA");
    actividadesLista.appendChild(li);
  });
}

if (tareas.length > 0) {
  const hTareas = document.createElement("h4");
  hTareas.textContent = "TAREAS";
  hTareas.style.color = "#ffa726"; // naranja
  actividadesLista.appendChild(hTareas);

  tareas.forEach((act) => {
    const li = document.createElement("li");
    li.innerHTML = act.hora
  ? `<span class="hora">${act.hora}</span> - ${act.descripcion}`
  : act.descripcion;

    li.classList.add("tipo-TAREA");
    actividadesLista.appendChild(li);
  });
}


  }
  console.log("Actividades agrupadas por fecha:", actividadesPorFecha);

  renderizarCalendario();
}

mesSelect.addEventListener("change", async () => {
  mesActual = parseInt(mesSelect.value);
  await cargarActividades();
  renderizarCalendario();
});

añoSelect.addEventListener("change", async () => {
  añoActual = parseInt(añoSelect.value);
  await cargarActividades();
  renderizarCalendario();
});

prevBtn.addEventListener("click", async () => {
  if (mesActual === 0) {
    mesActual = 11;
    añoActual--;
  } else {
    mesActual--;
  }
  mesSelect.value = mesActual;
  añoSelect.value = añoActual;
  await cargarActividades();
  renderizarCalendario();
});

nextBtn.addEventListener("click", async () => {
  if (mesActual === 11) {
    mesActual = 0;
    añoActual++;
  } else {
    mesActual++;
  }
  mesSelect.value = mesActual;
  añoSelect.value = añoActual;
  await cargarActividades();
  renderizarCalendario();
});

// Inicialización
poblarSelects();
cargarActividades().then(() => {
  // Seleccionar el día actual por defecto al cargar
  const today = new Date();
  const year = today.getFullYear();
  const month = (today.getMonth() + 1).toString().padStart(2, '0');
  const day = today.getDate().toString().padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  seleccionarDia(todayStr); // Selecciona el día actual al iniciar
});
