// ingredientes.js — v2 (base + precio/pack, sin duplicar base)
import { supabase } from './supabaseClient.js';

export async function guardarIngrediente() {
  // --- Datos del formulario (ficha base) ---
  const nombre      = document.getElementById('ingrediente-nombre').value.trim();
  const baseCantRaw = document.getElementById('ingrediente-cantidad').value;
  const baseUnidad  = (document.getElementById('ingrediente-unidad').value || '').trim();

  // --- Precio en supermercado ---
  const supermercado = (document.getElementById('ingrediente-supermercado').value || '').trim();
  const precioRaw    = document.getElementById('ingrediente-precio').value;

  // --- Nutrición (opcionales) ---
  const calRaw = document.getElementById('ingrediente-calorias').value;
  const protRaw= document.getElementById('ingrediente-proteinas').value;

  // --- Pack opcional distinto al base (si pones estos inputs en el HTML) ---
  // Si NO existen en el DOM, quedarán null y heredará del base.
  const packCantDom = document.getElementById('pack-cantidad');
  const packUndDom  = document.getElementById('pack-unidad');
  const packCantRaw = packCantDom ? packCantDom.value : '';
  const packUndRaw  = packUndDom  ? packUndDom.value  : '';

  // Validación mínima
  const baseCantidad = Number(baseCantRaw);
  const precio       = Number(precioRaw);
  if (!nombre || !supermercado || !Number.isFinite(baseCantidad) || !baseUnidad || !Number.isFinite(precio)) {
    alert('Completa: nombre, supermercado, cantidad base, unidad base y precio.');
    return;
  }

  // Login
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) {
    alert('No hay sesión activa. Inicia sesión primero.');
    return;
  }

  // Campos opcionales a null si están vacíos
  const calorias  = Number.isFinite(Number(calRaw))  ? Number(calRaw)  : null;
  const proteinas = Number.isFinite(Number(protRaw)) ? Number(protRaw) : null;

  // Pack opcional
  const packCantidad = Number.isFinite(Number(packCantRaw)) ? Number(packCantRaw) : null;
  const packUnidad   = (packUndRaw || '').trim() || null;

  try {
    // 1) Buscar si ya existe ficha base (nombre + owner)
    const { data: existing, error: selErr } = await supabase
      .from('ingredientes_base')
      .select('id')
      .eq('owner_id', uid)
      .ilike('nombre', nombre)        // comparación case-insensitive
      .maybeSingle();

    if (selErr) throw selErr;

    let baseId = existing?.id;

    // 2) Crear ficha base si no existe
    if (!baseId) {
      const { data: ins, error: insErr } = await supabase
        .from('ingredientes_base')
        .insert([{
          nombre,
          cantidad_base: baseCantidad, // si tu columna se llama 'cantidad', cambia aquí
          unidad: baseUnidad,
          calorias,
          proteinas,
          owner_id: uid
        }])
        .select('id')
        .single();

      if (insErr) throw insErr;
      baseId = ins.id;
    }

    // 3) Crear registro de precio en supermercado (histórico o pack distinto)
    //    - Si packCantidad/packUnidad son null ⇒ hereda cantidad_base/unidad del base
    const { error: ismErr } = await supabase
      .from('ingredientes_supermercado')
      .insert([{
        ingrediente_id: baseId,
        supermercado,
        precio,
        cantidad: packCantidad ?? null,
        unidad:   packUnidad   ?? null,
        fecha_precio: new Date().toISOString()
      }]);

    if (ismErr) throw ismErr;

    alert('Ingrediente guardado correctamente');
    // Opcional: limpia el formulario
    // document.getElementById('formulario-ingrediente').reset();
  } catch (e) {
    console.error('Error guardando ingrediente:', e);
    alert('Error al guardar ingrediente');
  }
}

// Mostrar/ocultar formulario (sin cambios)
document.getElementById('btn-ingrediente-actividad').addEventListener('click', () => {
  document.getElementById('formulario-ingrediente').classList.remove('oculto');
});
document.getElementById('cancelar-ingrediente').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('formulario-ingrediente').classList.add('oculto');
});

// Listado simple de fichas base del usuario
async function cargarIngredientes() {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return;

  // OJO: ajusta 'cantidad_base' ⇄ 'cantidad' según tu esquema real
  const { data, error } = await supabase
    .from('ingredientes_base')
    .select('id, nombre, cantidad_base, unidad')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al cargar ingredientes (ingredientes_base):', error);
    return;
  }

  const contenedor = document.getElementById('lista-ingredientes');
  contenedor.innerHTML = '';
  (data || []).forEach((ing) => {
    const item = document.createElement('div');
    const cant = ing.cantidad_base ?? '';
    const und  = ing.unidad ?? '';
    item.textContent = `${ing.nombre} – ${cant} ${und}`.trim();
    contenedor.appendChild(item);
  });
}
document.addEventListener('DOMContentLoaded', cargarIngredientes);
