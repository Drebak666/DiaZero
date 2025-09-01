import { supabase } from './supabaseClient.js';

// ===================== Helpers robustos =====================
const nrm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function getUid() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch { return null; }
}

async function safeSelect(table, select, filters = []) {
  try {
    let q = supabase.from(table).select(select);
    for (const f of filters) {
      const [fn, ...args] = f; // ej.: ['eq','owner_id', uid]
      q = q[fn](...args);
    }
    const { data, error } = await q;
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// Nombres ya registrados por el usuario: intenta primero ingredientes_base
async function fetchIngredientNames(uid){
  let rows = await safeSelect('ingredientes_base', 'nombre', [['eq','owner_id', uid]]);
  if (!rows.length) {
    rows = await safeSelect('ingredientes', 'nombre', [['eq','owner_id', uid]]);
  }
  return rows.map(r => r?.nombre).filter(Boolean);
}

// Supermercados únicos para datalist (base -> ingredientes)
async function fetchSupermercados(uid){
  let rows = await safeSelect('ingredientes_base', 'supermercado', [['eq','owner_id', uid]]);
  if (!rows.length) {
    rows = await safeSelect('ingredientes', 'supermercado', [['eq','owner_id', uid]]);
  }
  return Array.from(new Set(rows.map(r => r?.supermercado).filter(s => s && s.trim() !== '')));
}

// ===================== Cargar pendientes =====================
export async function cargarIngredientesPendientes() {
  const contenedor = document.getElementById('contenedor-ingredientes-pendientes');
  if (!contenedor) return;
  contenedor.innerHTML = 'Cargando...';

  const uid = await getUid();
  if (!uid) { contenedor.innerHTML = 'Sin sesión.'; return; }

  // Despensa del usuario
  const despensa = await safeSelect('despensa', '*', [['eq','owner_id', uid]]);
  if (!despensa.length) { contenedor.innerHTML = '<p>No hay ingredientes en despensa.</p>'; return; }

  // Ingredientes ya convertidos (por nombre)
  const nombresConvertidos = await fetchIngredientNames(uid);
  const setConvertidos = new Set(nombresConvertidos.map(nrm));

  // Filtra los que faltan por convertir
  const pendientes = despensa.filter(d => !setConvertidos.has(nrm(d.nombre)));
  if (!pendientes.length) { contenedor.innerHTML = '<p>No hay ingredientes pendientes.</p>'; return; }

  // Render
  contenedor.innerHTML = '';
  for (const item of pendientes) {
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
  }

  // Borrar de despensa
  contenedor.querySelectorAll('.btn-borrar').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      await supabase.from('despensa').delete().eq('id', id).eq('owner_id', uid);
      cargarIngredientesPendientes();
      if (typeof window.cargarDespensa === 'function') window.cargarDespensa();
    });
  });

  // Abrir modal completar
  const formCompletarIngrediente = document.getElementById('form-completar-ingrediente');
  const modalCompletar = document.getElementById('modal-completar');
  const compNombreInput = document.getElementById('comp-nombre');

  contenedor.querySelectorAll('.btn-convertir').forEach(btn => {
    btn.addEventListener('click', () => {
      compNombreInput.value = btn.dataset.nombre;
      formCompletarIngrediente.dataset.id = btn.dataset.id;
      modalCompletar.classList.remove('oculto');
      modalCompletar.style.display = 'block';
    });
  });
}

// ===================== Guardar conversión =====================
document.getElementById('form-completar-ingrediente')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const uid = await getUid();
  if (!uid) return;

  const form = e.currentTarget;
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

  // Inserta en 'ingredientes' (despensa formalizada)
  {
    const { error } = await supabase.from('ingredientes').insert([{ ...nuevoIngrediente, owner_id: uid }]);
    if (error) { console.error('❌ Error "ingredientes":', error.message); return; }
  }

  // Upsert en 'ingredientes_base' (catálogo) con conflicto (nombre, owner_id)
  {
    const { error } = await supabase
      .from('ingredientes_base')
      .upsert([{
        nombre: nuevoIngrediente.nombre,
        unidad: nuevoIngrediente.unidad,
        cantidad: nuevoIngrediente.cantidad,
        calorias: nuevoIngrediente.calorias,
        proteinas: nuevoIngrediente.proteinas,
        owner_id: uid
      }], { onConflict: 'nombre,owner_id' });
    if (error) { console.error('❌ Error "ingredientes_base":', error.message); return; }
  }

  // Buscar id base (scoped por owner_id) para consultar pack real de supermercado
  const { data: ingredienteBase } = await supabase
    .from('ingredientes_base')
    .select('id')
    .eq('nombre', nuevoIngrediente.nombre)
    .eq('owner_id', uid)
    .maybeSingle();

  let cantidadRealComprada = nuevoIngrediente.cantidad;
  let unidadRealComprada = nuevoIngrediente.unidad;

  if (ingredienteBase?.id) {
    const { data: supermercadoData } = await supabase
      .from('ingredientes_supermercado')
      .select('cantidad, unidad')
      .eq('ingrediente_id', ingredienteBase.id)
      .order('fecha_precio', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (supermercadoData) {
      cantidadRealComprada = supermercadoData.cantidad ?? cantidadRealComprada;
      unidadRealComprada = supermercadoData.unidad ?? unidadRealComprada;
    }
  }

  // Actualiza despensa con el pack real
  await supabase
    .from('despensa')
    .update({ cantidad: cantidadRealComprada, unidad: unidadRealComprada })
    .eq('id', idDespensa)
    .eq('owner_id', uid);

  // Cierra modal y refresca pantallas
  const modalCompletar = document.getElementById('modal-completar');
  modalCompletar.classList.add('oculto');
  modalCompletar.style.display = 'none';
  form.reset();
  cargarIngredientesPendientes();
  if (typeof window.cargarDespensa === 'function') window.cargarDespensa();
});

// Cerrar modal manualmente
document.getElementById('cerrar-completar')?.addEventListener('click', () => {
  const modalCompletar = document.getElementById('modal-completar');
  modalCompletar.classList.add('oculto');
  modalCompletar.style.display = 'none';
});

// ===================== Supermercados (datalist) =====================
export async function cargarSupermercadosUnicos() {
  const uid = await getUid();
  if (!uid) return;

  const supermercados = await fetchSupermercados(uid);
  const datalist = document.getElementById('supermercados');
  if (!datalist) return;
  datalist.innerHTML = '';
  supermercados.forEach((nombre) => {
    const option = document.createElement('option');
    option.value = nombre;
    datalist.appendChild(option);
  });
}

// ===================== Init =====================
window.addEventListener('DOMContentLoaded', () => {
  cargarIngredientesPendientes();
  cargarSupermercadosUnicos();
});
