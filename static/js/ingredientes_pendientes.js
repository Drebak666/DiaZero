import { supabase } from './supabaseClient.js';


async function cargarIngredientesPendientes() {
  const contenedor = document.getElementById('contenedor-ingredientes-pendientes');
  contenedor.innerHTML = 'Cargando...';

  // UID
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) { contenedor.innerHTML = 'Sin sesión.'; return; }

  // Despensa del usuario
  const { data: despensa, error: errorDespensa } = await supabase
    .from('despensa')
    .select('*')
    .eq('owner_id', uid);

  if (errorDespensa) { contenedor.innerHTML = 'Error al cargar la despensa.'; return; }

  // Ingredientes ya registrados (usa nombre)
  const { data: ingredientes, error: errorIngredientes } = await supabase
    .from('ingredientes')
    .select('nombre')
    .eq('owner_id', uid);

  if (errorIngredientes) { contenedor.innerHTML = 'Error al cargar ingredientes.'; return; }

  // Filtrar pendientes: los que no están en ingredientes
  const yaConvertidos = new Set((ingredientes || []).map(i => i.nombre));
  const pendientes = (despensa || []).filter(d => !yaConvertidos.has(d.nombre));

  if (!pendientes.length) { contenedor.innerHTML = '<p>No hay ingredientes pendientes.</p>'; return; }

  contenedor.innerHTML = '';
  pendientes.forEach(item => {
    const div = document.createElement('div');
    div.classList.add('pendiente-card');
    div.innerHTML = `
      <span>${item.nombre}</span>
      <div class="acciones">
        <button class="btn-convertir" data-nombre="${item.nombre}" data-id="${item.id}">Completar</button>
        <button class="btn-borrar" data-id="${item.id}">❌</button>
      </div>
    `;
    contenedor.appendChild(div);
  });

  // Borrar
  document.querySelectorAll('.btn-borrar').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await supabase.from('despensa').delete().eq('id', id).eq('owner_id', uid);
      cargarIngredientesPendientes();
    });
  });

  // Completar (abrir modal)
  const formCompletarIngrediente = document.getElementById('form-completar-ingrediente');
  const modalCompletar = document.getElementById('modal-completar');
  const compNombreInput = document.getElementById('comp-nombre');

  document.querySelectorAll('.btn-convertir').forEach(btn => {
    btn.addEventListener('click', () => {
      compNombreInput.value = btn.dataset.nombre;
      formCompletarIngrediente.dataset.id = btn.dataset.id;
      modalCompletar.classList.remove('oculto');
      modalCompletar.style.display = 'block';
    });
  });
}



// Evento para guardar el nuevo ingrediente
document.getElementById('form-completar-ingrediente').addEventListener('submit', async (e) => {
  e.preventDefault();

  // UID
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return;

  const form = e.target;
  const idDespensa = form.dataset.id;

  let unidadVal = document.getElementById('comp-unidad').value.trim();
  if (!unidadVal) unidadVal = 'ud';

  const nuevoIngrediente = {
    nombre: document.getElementById('comp-nombre').value.trim(),
    supermercado: document.getElementById('comp-supermercado').value.trim() || null,
    precio: parseFloat(document.getElementById('comp-precio').value) || null,
    cantidad: parseFloat(document.getElementById('comp-cantidad').value) || null,
    unidad: unidadVal,
    calorias: parseFloat(document.getElementById('comp-calorias').value) || null,
    proteinas: parseFloat(document.getElementById('comp-proteinas').value) || null
  };

  // Inserta en 'ingredientes'
  const { error: insertError } = await supabase.from('ingredientes').insert([{ ...nuevoIngrediente, owner_id: uid }]);
  if (insertError) { console.error('❌ Error "ingredientes":', insertError.message); return; }

  // Upsert en 'ingredientes_base' con conflicto (nombre, owner_id)
  const { error: upsertBaseError } = await supabase
    .from('ingredientes_base')
    .upsert([{
      nombre: nuevoIngrediente.nombre,
      unidad: nuevoIngrediente.unidad,
      cantidad: nuevoIngrediente.cantidad,
      calorias: nuevoIngrediente.calorias,
      proteinas: nuevoIngrediente.proteinas,
      owner_id: uid
    }], { onConflict: 'nombre,owner_id' });

  if (upsertBaseError) { console.error('❌ Error "ingredientes_base":', upsertBaseError.message); return; }

  // Buscar id base (scoped por owner_id)
  const { data: ingredienteBase, error: baseError } = await supabase
    .from("ingredientes_base")
    .select("id")
    .eq("nombre", nuevoIngrediente.nombre)
    .eq("owner_id", uid)
    .maybeSingle();

  let cantidadRealComprada = nuevoIngrediente.cantidad;
  let unidadRealComprada = nuevoIngrediente.unidad;

  // Si hay histórico de supermercado, usa su pack real
  if (ingredienteBase?.id) {
    const { data: supermercadoData } = await supabase
      .from("ingredientes_supermercado")
      .select("cantidad, unidad")
      .eq("ingrediente_id", ingredienteBase.id)
        .order("fecha_precio", { ascending: false })
  .maybeSingle();

    if (supermercadoData) {
      cantidadRealComprada = supermercadoData.cantidad ?? cantidadRealComprada;
      unidadRealComprada = supermercadoData.unidad ?? unidadRealComprada;
    }
  }

  // Actualiza despensa (por id y owner)
  await supabase.from('despensa').update({
    cantidad: cantidadRealComprada,
    unidad: unidadRealComprada
  }).eq('id', idDespensa).eq('owner_id', uid);

  // Cierra modal y refresca
  const modalCompletar = document.getElementById('modal-completar');
  modalCompletar.classList.add('oculto');
  modalCompletar.style.display = 'none';
  form.reset();
  cargarIngredientesPendientes();
  if (typeof cargarDespensa === 'function') cargarDespensa();
});



// Evento para cerrar el modal "Completar ingrediente"
document.getElementById('cerrar-completar').addEventListener('click', () => {
  const modalCompletar = document.getElementById('modal-completar');
  modalCompletar.classList.add('oculto');
  modalCompletar.style.display = 'none'; // Forzar ocultamiento
});

async function cargarSupermercadosUnicos() {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return;

  const { data: ingredientes, error } = await supabase
    .from('ingredientes')
    .select('supermercado')
    .eq('owner_id', uid);

  if (error) {
    console.warn('No se pudo cargar supermercados', error.message);
    return;
  }

  const supermercados = new Set(
    (ingredientes || [])
      .map(i => i.supermercado)
      .filter(s => s && s.trim() !== '')
  );

  const datalist = document.getElementById('supermercados');
  datalist.innerHTML = '';
  supermercados.forEach(nombre => {
    const option = document.createElement('option');
    option.value = nombre;
    datalist.appendChild(option);
  });
}

// Iniciar pantalla al cargar
window.addEventListener('DOMContentLoaded', () => {
  cargarIngredientesPendientes();
  cargarSupermercadosUnicos();
});
