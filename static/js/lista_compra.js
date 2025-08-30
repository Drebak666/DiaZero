// static/js/lista_compra.js
import { supabase } from './supabaseClient.js';
import { getUsuarioActivo } from './usuario.js';

const form = document.getElementById('form-lista');
const inputNombre = document.getElementById('nombre-item');
const container = document.getElementById('lista-compra-container');

const supermercado1Select = document.getElementById('super1');
const supermercado2Select = document.getElementById('super2');
const total1Span = document.getElementById('total-super1');
const total2Span = document.getElementById('total-super2');

// === Helper: UID actual (prefiere sesión; fallback a tabla usuarios por username)
async function getUidActual() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) return user.id;
  } catch (_) {}
  const username = getUsuarioActivo();
  if (!username) return null;
  const { data: uRow } = await supabase
    .from('usuarios')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  return uRow?.id || null;
}

// ====== Añadir nuevo artículo ======
// === Helper: UID actual (prefiere sesión; fallback a tabla usuarios por username)
// (esto ya lo tienes bien)

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = inputNombre.value.trim().toLowerCase();
  if (!texto) return;

  const uid = await getUidActual();
  if (!uid) return;

  // 👇 CAMBIO: usa owner_id y acepta description|nombre
  const { data: ingredientes } = await supabase
    .from('ingredientes_base')
    .select('description, nombre')   // cualquiera que exista
    .eq('owner_id', uid);           // <-- antes ponía usuario_id

  const normalizar = str => (str || '').toLowerCase().trim().replace(/(es|s)$/, '');
  const getDesc = i => (i?.description ?? i?.nombre ?? '');
  const existentes = new Set((ingredientes || []).map(i => normalizar(getDesc(i))));

  const singular = str => str.replace(/(es|s)$/, '');
  const palabras = texto.split(/\s+/);
  const resultado = [];

  let i = 0;
  while (i < palabras.length) {
    let encontrado = false;
    for (let len = 3; len >= 1; len--) {
      const grupo = palabras.slice(i, i + len).join(' ');
      const grupoSinPlural = singular(grupo);
      if (existentes.has(normalizar(grupo)) || existentes.has(normalizar(grupoSinPlural))) {
        resultado.push(grupo);
        i += len;
        encontrado = true;
        break;
      }
    }
    if (!encontrado) {
      if (palabras[i] === 'de' && resultado.length > 0 && palabras[i + 1]) {
        resultado[resultado.length - 1] += ' de ' + palabras[i + 1];
        i += 2;
      } else {
        resultado.push(palabras[i]);
        i++;
      }
    }
  }

  const nombres = [...new Set(resultado.map(s => s.trim()).filter(Boolean))];
  for (const nombre of nombres) {
    await supabase.from('lista_compra').insert([{ nombre, owner_id: uid }]);
  }

  inputNombre.value = '';
  await cargarLista();
  await cargarPendientes();
  await actualizarContadorLista();
});


// ====== Cargar lista ======
async function cargarLista() {
  const uid = await getUidActual();
  if (!uid) return;

  const { data: lista } = await supabase
  .from('lista_compra')
  .select('id, nombre, completado, cantidad, unidad, created_at')
  .eq('owner_id', uid)
  .order('created_at', { ascending: true });

  if (!lista || lista.length === 0) {
    container.innerHTML = '<p>No hay ingredientes en la lista.</p>';
    supermercado1Select.innerHTML = '<option value="Lidl">Lidl</option>';
    supermercado1Select.value = 'Lidl';
    supermercado2Select.innerHTML = '<option value="Mercadona">Mercadona</option>';
    supermercado2Select.value = 'Mercadona';
    total1Span.textContent = '0.00€';
    total2Span.textContent = '0.00€';
    return;
  }

  // catálogo del usuario (TABLA BASE)
  const { data: ingredientes } = await supabase
  .from('ingredientes_base')
  .select('description, supermercado, precio, cantidad, unidad')
  .eq('owner_id', uid);

  const mapaIngredientes = new Map();
  const supermercadosUnicos = new Set();
  const existentesSet = new Set((ingredientes || []).map(i => i.description.trim().toLowerCase().replace(/(es|s)$/, '')));

  (ingredientes || []).forEach(i => {
    const key = i.description.trim().toLowerCase().replace(/(es|s)$/, '');
    if (i.supermercado) supermercadosUnicos.add(i.supermercado);
    if (!mapaIngredientes.has(key)) mapaIngredientes.set(key, []);
    mapaIngredientes.get(key).push(i);
  });

  // Llenar selects (conservar selección)
  const prevSuper1 = supermercado1Select.value;
  const prevSuper2 = supermercado2Select.value;
  supermercado1Select.innerHTML = '<option value="">--Elige--</option>';
  supermercado2Select.innerHTML = '<option value="">--Elige--</option>';

  [...supermercadosUnicos].sort().forEach(s => {
    const o1 = document.createElement('option'); o1.value = s; o1.textContent = s; supermercado1Select.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = s; o2.textContent = s; supermercado2Select.appendChild(o2);
  });

  if (prevSuper1 && supermercadosUnicos.has(prevSuper1)) supermercado1Select.value = prevSuper1;
  else if (supermercadosUnicos.has('Lidl')) supermercado1Select.value = 'Lidl';

  if (prevSuper2 && supermercadosUnicos.has(prevSuper2)) supermercado2Select.value = prevSuper2;
  else if (supermercadosUnicos.has('Mercadona')) supermercado2Select.value = 'Mercadona';

  if (supermercado1Select.options.length === 1) { supermercado1Select.innerHTML += '<option value="Lidl">Lidl</option>'; supermercado1Select.value = 'Lidl'; }
  if (supermercado2Select.options.length === 1) { supermercado2Select.innerHTML += '<option value="Mercadona">Mercadona</option>'; supermercado2Select.value = 'Mercadona'; }

  const super1 = supermercado1Select.value || null;
  const super2 = supermercado2Select.value || null;

  const toBase = (cant, uni) => {
    const n = Number(cant) || 0;
    const u = (uni || '').toLowerCase();
    if (u === 'kg') return { c: n * 1000, u: 'g' };
    if (u === 'g')  return { c: n,         u: 'g' };
    if (u === 'l')  return { c: n * 1000,  u: 'ml' };
    if (u === 'ml') return { c: n,         u: 'ml' };
    return { c: n, u: 'ud' };
  };

  const completados = [], pendientes = [];
  lista.forEach(item => item.completado ? completados.push(item) : pendientes.push(item));
  const ordenados = [...pendientes, ...completados];

  let total1 = 0, total2 = 0;
  const list = document.createElement('ul');

  ordenados.forEach(item => {
    const nombreNormalizado = item.nombre.trim().toLowerCase().replace(/(es|s)$/, '');
    const coincidencias = mapaIngredientes.get(nombreNormalizado) || [];

    const prod1 = coincidencias.find(i => i.supermercado === super1) || null;
    const prod2 = coincidencias.find(i => i.supermercado === super2) || null;
    const ref   = prod1 || prod2 || coincidencias[0] || null;

    let packs = 1;
    let textoCantidad = '—';
    if (ref && ref.cantidad && (item.cantidad || item.unidad)) {
      const need = toBase(item.cantidad, item.unidad);
      const pack = toBase(ref.cantidad, ref.unidad);
      packs = pack.c > 0 ? Math.ceil(need.c / pack.c) : 1;
      textoCantidad = `${item.cantidad ?? ref.cantidad} ${item.unidad ?? ref.unidad}`;
      if (packs > 1) textoCantidad += ` · ≈${packs} pack${packs > 1 ? 's' : ''}`;
    } else if (ref && ref.cantidad) {
      textoCantidad = `${ref.cantidad} ${ref.unidad}`;
    }

    const precio1 = prod1 && prod1.precio != null ? prod1.precio * packs : null;
    const precio2 = prod2 && prod2.precio != null ? prod2.precio * packs : null;
    if (precio1 != null) total1 += precio1;
    if (precio2 != null) total2 += precio2;

    const li = document.createElement('li');
    li.classList.add('lista-item');

    const clase1 = (precio1 != null && precio2 != null && precio1 < precio2) ? 'text-green-600 font-bold' : '';
    const clase2 = (precio1 != null && precio2 != null && precio2 < precio1) ? 'text-green-600 font-bold' : '';

    const esIngrediente = existentesSet.has(nombreNormalizado);
    const nombreClase = item.completado
      ? 'line-through text-gray-400'
      : (esIngrediente ? 'text-green-600 font-bold' : '');

    li.innerHTML = `
      <div class="item-linea">
        <div class="item-izquierda">
          <input type="checkbox" class="completado-checkbox" data-id="${item.id}" ${item.completado ? 'checked' : ''}>
          <div class="item-nombre-cantidad">
            <span class="item-nombre ${nombreClase}">${item.nombre}</span>
            <span class="item-cantidad">${textoCantidad}</span>
          </div>
        </div>
        <div class="item-derecha">
          <span class="item-precio ${clase1}">${precio1 != null ? precio1.toFixed(2) + '€' : '—'}</span>
          <span class="item-precio ${clase2}">${precio2 != null ? precio2.toFixed(2) + '€' : '—'}</span>
          <div class="lista-botones">
            <button class="boton-redondo boton-amarillo editar-btn" data-id="${item.id}" title="Editar">
              <i class="fas fa-edit"></i>
            </button>
            <button class="boton-redondo boton-rojo borrar-btn" data-id="${item.id}" title="Borrar">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    list.appendChild(li);
  });

  container.innerHTML = '';
  container.appendChild(list);

  total1Span.textContent = total1.toFixed(2) + '€';
  total2Span.textContent = total2.toFixed(2) + '€';

  document.querySelectorAll('.borrar-btn').forEach(btn => btn.addEventListener('click', borrarItem));
  document.querySelectorAll('.editar-btn').forEach(btn => btn.addEventListener('click', editarItem));
  document.querySelectorAll('.completado-checkbox').forEach(checkbox =>
    checkbox.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      const completado = e.target.checked;
      await supabase.from('lista_compra').update({ completado }).eq('id', id);
      cargarLista();
      cargarPendientes();
    })
  );
}

function borrarItem(e) {
  const id = e.target.dataset.id;
  supabase.from('lista_compra').delete().eq('id', id).then(() => {
    cargarLista();
    cargarPendientes();
  });
}

function editarItem(e) {
  const id = e.target.dataset.id;
  const li = e.target.closest('li');
  if (li.classList.contains('editando')) return;
  li.classList.add('editando');

  const span = li.querySelector('.item-nombre');
  const nombre = span.textContent.trim();

  const form = document.createElement('form');
  form.classList.add('form-editar');
  form.innerHTML = `
    <input type="text" name="nombre" value="${nombre}" required class="editar-input">
    <button type="submit" class="editar-guardar" title="Guardar"><i class="fas fa-save"></i></button>
    <button type="button" class="editar-cancelar cancelar-edicion" title="Cancelar"><i class="fas fa-times"></i></button>
  `;
  span.replaceWith(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nuevoNombre = form.nombre.value.trim();
    await supabase.from('lista_compra').update({ nombre: nuevoNombre }).eq('id', id);
    li.classList.remove('editando');
    cargarLista();
    cargarPendientes();
    actualizarContadorLista();
  });

  form.querySelector('.cancelar-edicion').addEventListener('click', () => {
    li.classList.remove('editando');
    cargarLista();
  });
}

// ====== Agregar completados a despensa ======
document.getElementById('agregar-completados-despensa').addEventListener('click', async () => {
  const uid = await getUidActual();
  if (!uid) return;

  const { data: completados } = await supabase
  .from('lista_compra')
  .select('*')
  .eq('completado', true)
  .eq('owner_id', uid);

  for (const item of (completados || [])) {
    // pack base desde ingredientes_base
    const { data: datosIngrediente } = await supabase
      .from('ingredientes_base')
      .select('cantidad, unidad')
      .eq('description', item.nombre)
      .eq('owner_id', uid)
      .maybeSingle();

    const cantidadComprada = datosIngrediente?.cantidad ?? 1;
    const unidadComprada = datosIngrediente?.unidad ?? 'ud';

    // buscar en despensa por nombre+unidad+uid
    const { data: existente } = await supabase
      .from('despensa')
      .select('id, cantidad')
      .eq('nombre', item.nombre)
      .eq('unidad', unidadComprada)
      .eq('owner_id', uid)
      .maybeSingle();

    if (existente) {
      const nuevaCantidad = (parseFloat(existente.cantidad) || 0) + (parseFloat(cantidadComprada) || 0);
      await supabase.from('despensa')
        .update({ cantidad: nuevaCantidad })
        .eq('id', existente.id);
    } else {
      await supabase.from('despensa').insert([{
  nombre: item.nombre,
  cantidad: cantidadComprada,
  unidad: unidadComprada,
  owner_id: uid
}]);
    }

    // borrar ese item de la lista
    await supabase.from('lista_compra')
      .delete()
      .eq('id', item.id);
  }

  await cargarLista();
  await cargarPendientes();
  await actualizarContadorLista();
});

// ====== Pendientes (vista rápida) ======
async function cargarPendientes() {
  const uid = await getUidActual();
  if (!uid) return;

  const { data: pendientes } = await supabase
  .from('despensa')
  .select('*')
  .eq('owner_id', uid)
  .order('created_at', { ascending: true });

  const contPendientes = document.getElementById('pendientes-container');
  if (!contPendientes) return;

  contPendientes.innerHTML = pendientes?.length
    ? pendientes.map(p => `<div>${p.nombre}</div>`).join('')
    : '<p>No hay productos pendientes.</p>';
}

// ====== Contador badge en navbar ======
async function actualizarContadorLista() {
  const uid = await getUidActual();
  if (!uid) return;

  const { data } = await supabase
  .from('lista_compra')
  .select('id')
  .eq('owner_id', uid)
  .eq('completado', false);

  const cantidad = data?.length ?? 0;
  document.querySelectorAll('.contador-lista').forEach(span => { span.textContent = cantidad; });
}

// ====== Init ======
document.addEventListener('DOMContentLoaded', () => {
  supermercado1Select.addEventListener('change', cargarLista);
  supermercado2Select.addEventListener('change', cargarLista);
  cargarLista();
  cargarPendientes();
  actualizarContadorLista();
});
