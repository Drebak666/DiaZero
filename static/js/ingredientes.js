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
    usuario_id: usuarioId, // 👈 ahora guardamos UID
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

const { data, error } = await supabase
  .from('ingredientes')
  .select('*')
  .eq('usuario_id', usuarioId)  // 👈 filtrar por UID
  .order('fecha_creacion', { ascending: false });


  if (error) {
    console.error('Error al cargar ingredientes:', error);
    return;
  }

  const contenedor = document.getElementById('lista-ingredientes');
  contenedor.innerHTML = '';

  data.forEach((ing) => {
    const item = document.createElement('div');
    item.textContent = `${ing.nombre} – ${ing.cantidad} ${ing.unidad}`;
    contenedor.appendChild(item);
  });
}

document.addEventListener('DOMContentLoaded', cargarIngredientes);