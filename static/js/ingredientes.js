import { supabase } from './supabaseClient.js';
import { getUsuarioActivo } from './usuario.js';


export async function guardarIngrediente() {
  const nombre = document.getElementById('ingrediente-nombre').value.trim();
  const supermercado = document.getElementById('ingrediente-supermercado').value;
  const precio = parseFloat(document.getElementById('ingrediente-precio').value);
  const cantidad = parseFloat(document.getElementById('ingrediente-cantidad').value);
  const unidad = document.getElementById('ingrediente-unidad').value;
  const calorias = parseFloat(document.getElementById('ingrediente-calorias').value);
  const proteinas = parseFloat(document.getElementById('ingrediente-proteinas').value);

  if (!nombre || isNaN(precio) || isNaN(cantidad)) {
    alert("Por favor, completa todos los campos obligatorios.");
    return;
  }

// obtener uid actual
const { data: { user } } = await supabase.auth.getUser();
const usuarioId = user?.id;
if (!usuarioId) {
  alert("No hay sesión activa. Inicia sesión primero.");
  return;
}

const { error } = await supabase.from('ingredientes_base').insert([
  {
    nombre,
    supermercado,
    precio,
    cantidad,
    unidad,
    calorias,
    proteinas,
owner_id: usuarioId,
    fecha_creacion: new Date().toISOString()
  }
]);



  if (error) {
    alert("Error al guardar ingrediente");
    console.error(error);
  } else {
    alert("Ingrediente guardado correctamente");
  }
}
// Mostrar el formulario
document.getElementById('btn-ingrediente-actividad').addEventListener('click', () => {
  document.getElementById('formulario-ingrediente').classList.remove('oculto');
});

// Cancelar y ocultar el formulario
document.getElementById('cancelar-ingrediente').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('formulario-ingrediente').classList.add('oculto');
});

async function cargarIngredientes() {
  const { data: { user } } = await supabase.auth.getUser();
  const usuarioId = user?.id;
  if (!usuarioId) return;

  let data = null, error = null;

  // 1º intento: ingredientes_base con created_at
  try {
    const res = await supabase
      .from('ingredientes_base')
      .select('id, nombre, cantidad, unidad, created_at, owner_id')
      .eq('owner_id', usuarioId)
      .order('created_at', { ascending: false });
    data = res.data; error = res.error;
  } catch (e) {}

  // 2º intento (por si tu columna temporal se llama fecha_creacion)
  if (error) {
    try {
      const res2 = await supabase
        .from('ingredientes_base')
        .select('id, nombre, cantidad, unidad, fecha_creacion, owner_id')
        .eq('owner_id', usuarioId)
        .order('fecha_creacion', { ascending: false });
      data = res2.data; error = res2.error;
    } catch (e) {}
  }

  // 3º fallback: sin ordenar si ambas columnas no existen
  if (error) {
    const res3 = await supabase
      .from('ingredientes_base')
      .select('id, nombre, cantidad, unidad, owner_id')
      .eq('owner_id', usuarioId);
    data = res3.data; error = res3.error;
  }

  if (error) {
    console.error('Error al cargar ingredientes (ingredientes_base):', error);
    return;
  }

  const contenedor = document.getElementById('lista-ingredientes');
  contenedor.innerHTML = '';

  (data || []).forEach((ing) => {
    const item = document.createElement('div');
    item.textContent = `${ing.nombre} – ${ing.cantidad ?? ''} ${ing.unidad ?? ''}`.trim();
    contenedor.appendChild(item);
  });
}

document.addEventListener('DOMContentLoaded', cargarIngredientes);