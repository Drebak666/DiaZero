import { supabase } from './supabaseClient.js';
import { calcularTotalesReceta } from '../utils/calculos_ingredientes.js';
import { getUsuarioActivo } from './usuario.js';


let recetasDisponibles = [];

async function cargarRecetas() {
  // 1. Cargar recetas con sus ingredientes
const usuario = getUsuarioActivo();

const { data: recetas, error } = await supabase
  .from("recetas")
  .select(`
    id,
    nombre,
    ingredientes_receta (
      cantidad,
      ingrediente_id
    )
  `)
  .eq("usuario", usuario); // ✅ Filtrar por el usuario activo


  if (error) {
    console.error("Error cargando recetas:", error);
    return;
  }

  recetasDisponibles = recetas;

  // 2. Recolectar todos los IDs de ingredientes usados
  const todosIds = new Set();
  recetas.forEach(receta => {
    receta.ingredientes_receta?.forEach(i => {
      if (i.ingrediente_id) todosIds.add(i.ingrediente_id);
    });
  });

  // 3. Cargar los ingredientes base necesarios
  const { data: ingredientesBase, error: errorIng } = await supabase
    .from("ingredientes_base")
.select('*')
.in("id", Array.from(todosIds))
.eq("usuario", usuario);


  if (errorIng) {
    console.error("Error al cargar ingredientes base:", errorIng);
    return;
  }

  // 4. Crear mapa para acceso rápido
  const mapaIngredientes = new Map();
  ingredientesBase.forEach(ing => {
    mapaIngredientes.set(ing.id, ing);
  });

  // 5. Llenar cada <select> con las recetas + info nutricional
  document.querySelectorAll(".selector-receta").forEach(select => {
    select.innerHTML = '<option value="">Selecciona una receta</option>';
    recetas.forEach(receta => {
      const option = document.createElement("option");
      option.value = receta.id;

      // Calcular valores con tu función reutilizada
      const totales = calcularTotalesReceta(receta.ingredientes_receta, Array.from(mapaIngredientes.values()));

      // Mostrar el nombre y los valores de forma sutil
option.innerHTML = `${receta.nombre} <span style="color:#7fa6c3; font-size: 0.9em;">(${totales.totalCalorias} kcal, ${totales.totalProteinas} g prot)</span>`;
      select.appendChild(option);
    });
  });
} // <--- Esta era la llave mal colocada que cerraba la función antes de tiempo

async function guardarRecetaEnBD(tipo, recetaId, fecha, dia, container) {
  if (!fecha) {
    console.error("Fecha no definida");
    return;
  }
const usuario = localStorage.getItem("usuario_actual") || "desconocido"; // ✅
const { error } = await supabase.from("comidas_dia").insert([{ tipo, receta_id: recetaId, fecha, dia, usuario }]);

  if (error) {
    console.error("Error al guardar la receta:", error);
    return;
  }
  await cargarMenuGuardado();
}

async function borrarRecetaDeBD(recetaId, tipo, fecha) {
  const { error } = await supabase.from("comidas_dia").delete().match({ receta_id: recetaId, tipo, fecha });
  if (error) console.error("Error al borrar receta:", error);
}

async function cargarMenuGuardado() {
  console.log("Iniciando cargarMenuGuardado...");
const usuario = localStorage.getItem("usuario_actual") || "desconocido";
const { data, error } = await supabase
  .from("comidas_dia")
  .select(`
    id, tipo, fecha, receta_id, dia,
    recetas (
      nombre,
      ingredientes_receta (
        cantidad,
        unidad,
        ingrediente_id
      )
    )
  `)
  .eq("usuario", usuario); // ✅ Aquí añades el filtro que falta


  if (error) {
    console.error("Error al cargar el menú guardado:", error);
    return;
  }
  console.log("Datos de comidas_dia cargados:", data);

  const ingredienteIds = [];
  data.forEach(entry => {
    entry.recetas?.ingredientes_receta?.forEach(item => {
      if (item.ingrediente_id && !ingredienteIds.includes(item.ingrediente_id)) {
        ingredienteIds.push(item.ingrediente_id);
      }
    });
  });
  console.log("IDs de ingredientes necesarios:", ingredienteIds);

  let ingredientesMap = new Map();
  if (ingredienteIds.length > 0) {
    const { data: ingredientesData, error: errorIng } = await supabase
      .from('ingredientes_base')
      .select('id, description, precio, unidad, cantidad, calorias, proteinas')
      .in('id', ingredienteIds);

    if (errorIng) {
      console.error("Error al cargar ingredientes:", errorIng);
      return;
    }
    console.log("Datos de ingredientes_base cargados:", ingredientesData);
    ingredientesData.forEach(ing => ingredientesMap.set(ing.id, ing));
  } else {
    console.log("No hay IDs de ingredientes para cargar.");
  }

  // Resetear los totales de cada comida-dia antes de recalcular
  document.querySelectorAll(".lista-recetas").forEach(ul => ul.innerHTML = "");
  document.querySelectorAll(".comida-dia").forEach(comidaDia => {
    const precioSpan = comidaDia.querySelector(".precio");
    const caloriasSpan = comidaDia.querySelector(".calorias");
    const proteinasSpan = comidaDia.querySelector(".proteinas");

    if (precioSpan) precioSpan.textContent = "0.00 €";
    if (caloriasSpan) caloriasSpan.textContent = "0";
    if (proteinasSpan) proteinasSpan.textContent = "0";
  });
  console.log("Totales de comida-dia reseteados.");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  data.forEach(entry => {
    const entryDate = new Date(entry.fecha);
    entryDate.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((entryDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0 || diffDays > 6) {
      console.log(`Saltando entrada para la fecha ${entry.fecha} (fuera del rango semanal).`);
      return;
    }

    const diaEl = document.querySelectorAll(".dia-menu")[diffDays];
    const indexTipo = ['Desayuno', 'Comida', 'Cena'].indexOf(entry.tipo);
    if (indexTipo === -1) {
      console.warn(`Tipo de comida desconocido: ${entry.tipo}`);
      return;
    }

    const comidaEl = diaEl.querySelectorAll(".comida-dia")[indexTipo];
    const ul = comidaEl.querySelector(".lista-recetas");

    const li = document.createElement("li");
    li.classList.add("actividad-item", "tarea");

    const infoDiv = document.createElement("div");
    infoDiv.classList.add("actividad-info");

    const descripcion = document.createElement("div");
    descripcion.classList.add("actividad-descripcion");
    descripcion.textContent = entry.recetas.nombre;

    infoDiv.appendChild(descripcion);

    const acciones = document.createElement("div");
    acciones.classList.add("actividad-actions");

    const btnBorrar = document.createElement("button");
    btnBorrar.classList.add("btn-delete");
    btnBorrar.innerHTML = "🗑️";  // O usa un icono SVG si prefieres
    btnBorrar.onclick = async () => {
      await borrarRecetaDeBD(entry.receta_id, entry.tipo, entry.fecha);
      await cargarMenuGuardado();
    };

    acciones.appendChild(btnBorrar);
    li.appendChild(infoDiv);
    li.appendChild(acciones);
    ul.appendChild(li);

    const { totalPrecio: precio, totalCalorias: calorias, totalProteinas: proteinas } =
      calcularTotalesReceta(entry.recetas.ingredientes_receta, Array.from(ingredientesMap.values()));

    console.log(`Totales calculados para ${entry.recetas.nombre}: Precio=${precio.toFixed(2)}, Calorias=${calorias.toFixed(0)}, Proteinas=${proteinas.toFixed(0)}`);

    sumarTotales(comidaEl, precio, calorias, proteinas);
  });
  actualizarResumenSemanal();
  actualizarTotalesPorDia();

  console.log("Fin de cargarMenuGuardado.");
}

function sumarTotales(container, precio, calorias, proteinas) {
  console.log(`sumarTotales llamado para container: ${container.className}, Precio: ${precio}, Calorias: ${calorias}, Proteinas: ${proteinas}`);
  const precioSpan = container.querySelector(".precio");
  const caloriasSpan = container.querySelector(".calorias");
  const proteinasSpan = container.querySelector(".proteinas");

  let precioActual = parseFloat(precioSpan.textContent.replace(" €", "") || 0);
  let caloriasActual = parseFloat(caloriasSpan.textContent || 0);
  let proteinasActual = parseFloat(proteinasSpan.textContent || 0);

  console.log(`  Valores actuales antes de sumar: Precio=${precioActual.toFixed(2)}, Calorias=${caloriasActual.toFixed(0)}, Proteinas=${proteinasActual.toFixed(0)}`);

  precioActual += precio;
  caloriasActual += calorias;
  proteinasActual += proteinas;

  precioSpan.textContent = precioActual.toFixed(2) + " €";
  caloriasSpan.textContent = caloriasActual.toFixed(0);
  proteinasSpan.textContent = proteinasActual.toFixed(0);
  console.log(`  Valores después de sumar: Precio=${precioSpan.textContent}, Calorias=${caloriasSpan.textContent}, Proteinas=${proteinasSpan.textContent}`);
}

function actualizarResumenSemanal() {
  console.log("Iniciando actualizarResumenSemanal...");
  let costeTotalSemanal = 0;
  let caloriasTotalesSemanal = 0;
  let proteinasTotalesSemanal = 0;

  document.querySelectorAll(".comida-dia").forEach(comidaDia => {
    const precioText = comidaDia.querySelector(".precio").textContent;
    const caloriasText = comidaDia.querySelector(".calorias").textContent;
    const proteinasText = comidaDia.querySelector(".proteinas").textContent;

    console.log(`  Obteniendo de comida-dia: Precio='${precioText}', Calorias='${caloriasText}', Proteinas='${proteinasText}'`);

    costeTotalSemanal += parseFloat(precioText.replace(" €", "") || 0);
    caloriasTotalesSemanal += parseFloat(caloriasText || 0);
    proteinasTotalesSemanal += parseFloat(proteinasText || 0);
  });

  document.getElementById("coste-semanal").textContent = costeTotalSemanal.toFixed(2) + " €";
  document.getElementById("calorias-semanales").textContent = caloriasTotalesSemanal.toFixed(0);
  document.getElementById("proteinas-semanales").textContent = proteinasTotalesSemanal.toFixed(0);
  console.log(`Resumen semanal actualizado: Coste=${costeTotalSemanal.toFixed(2)}, Calorias=${caloriasTotalesSemanal.toFixed(0)}, Proteinas=${proteinasTotalesSemanal.toFixed(0)}`);
  console.log("Fin de actualizarResumenSemanal.");
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM completamente cargado. Iniciando carga de datos.");
  await cargarRecetas();
  await cargarMenuGuardado();

  const botonesAñadir = document.querySelectorAll(".btn-add");
  botonesAñadir.forEach(boton => {
    boton.addEventListener("click", async (e) => {
      const container = e.target.closest(".comida-dia");
      const select = container.querySelector(".selector-receta");
      const recetaId = select.value;
      if (!recetaId) {
        console.warn("No se ha seleccionado ninguna receta.");
        return;
      }

      const tipo = container.querySelector('h3').textContent;
      const diaSection = container.closest(".dia-menu");
      const fecha = diaSection ? diaSection.getAttribute("data-fecha") : null;
      const dia = diaSection ? diaSection.querySelector('h2').textContent : null;

      if (!fecha) {
        console.error("No se pudo obtener la fecha del contenedor .dia-menu");
        return;
      }
      if (!dia) {
        console.error("No se pudo obtener el día del contenedor .dia-menu");
        return;
      }

      console.log(`Añadiendo receta: Tipo=${tipo}, Receta ID=${recetaId}, Fecha=${fecha}, Día=${dia}`);
      await guardarRecetaEnBD(tipo, recetaId, fecha, dia, container);
    });
  });

  const dias = document.querySelectorAll(".dia-menu");
  let indice = 0;

  function mostrarDia(i) {
    dias.forEach((d, idx) => d.style.display = (idx === i ? "block" : "none"));
    actualizarTotalesPorDia();
  }

  mostrarDia(indice);

  document.getElementById("next-dia").addEventListener("click", () => {
    indice = (indice + 1) % dias.length;
    mostrarDia(indice);
  });

  document.getElementById("prev-dia").addEventListener("click", () => {
    indice = (indice - 1 + dias.length) % dias.length;
    mostrarDia(indice);
  });
});

function actualizarTotalesPorDia() {
  const secciones = document.querySelectorAll(".dia-menu");
  secciones.forEach((seccion, i) => {
    const comidas = seccion.querySelectorAll(".comida-dia");
    let precio = 0, calorias = 0, proteinas = 0;

    comidas.forEach(comida => {
      precio += parseFloat(comida.querySelector(".precio").textContent.replace(" €", "") || 0);
      calorias += parseFloat(comida.querySelector(".calorias").textContent || 0);
      proteinas += parseFloat(comida.querySelector(".proteinas").textContent || 0);
    });

    const resumen = document.querySelectorAll(".totales-dia")[i];
    resumen.querySelector(".precio-dia").textContent = precio.toFixed(2) + " €";
    resumen.querySelector(".calorias-dia").textContent = calorias.toFixed(0);
    resumen.querySelector(".proteinas-dia").textContent = proteinas.toFixed(0);
  });
}
