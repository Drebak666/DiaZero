// static/js/lista_compra.js (unificado con badge global)
// - Inserta con completado:false
// - Quita contador local y usa window.updateShoppingBadge?.()
// - Llama al badge tras insertar/editar/borrar/tick/añadir a despensa

import { supabase } from './supabaseClient.js';
import { getUsuarioActivo } from './usuario.js';

const form = document.getElementById('form-lista');
const inputNombre = document.getElementById('nombre-item');
const container = document.getElementById('lista-compra-container');

const supermercado1Select = document.getElementById('super1');
const supermercado2Select = document.getElementById('super2');
const total1Span = document.getElementById('total-super1');
const total2Span = document.getElementById('total-super2');

// ================= Helpers sesión/uid =================
async function getUidActual() {
  try { const { data: { user } } = await supabase.auth.getUser(); if (user?.id) return user.id; } catch {}
  try { const { data: { session } } = await supabase.auth.getSession(); if (session?.user?.id) return session.user.id; } catch {}
  try {
    const username = getUsuarioActivo?.();
    if (username) {
      const { data: uRow } = await supabase.from('usuarios').select('id').eq('username', username).maybeSingle();
      if (uRow?.id) return uRow.id;
    }
  } catch {}
  return null;
}

const nrm = (s) => (s || '').toLowerCase().trim();
const singular = (str) => String(str).replace(/(es|s)$/i, '');

// ================= Añadir a la lista =================
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = nrm(inputNombre.value);
  if (!texto) return;

  const uid = await getUidActual();
  const { data: cat } = await supabase.from('ingredientes_base').select('nombre');
  const existentes = new Set((cat || []).map(r => singular(nrm(r.nombre))));

  const palabras = texto.split(/\s+/);
  const resultado = [];
  for (let i = 0; i < palabras.length; ) {
    let match = null, len = 0;
    for (let L = 3; L >= 1; L--) {
      const grupo = palabras.slice(i, i + L).join(' ');
      const key = singular(nrm(grupo));
      if (existentes.has(key)) { match = grupo; len = L; break; }
    }
    if (match) { resultado.push(match); i += len; continue; }
    if (i + 2 < palabras.length && ['de','del','con','sin'].includes(palabras[i+1])) {
      resultado.push(`${palabras[i]} ${palabras[i+1]} ${palabras[i+2]}`); i += 3; continue;
    }
    resultado.push(palabras[i]); i++;
  }

  const nombres = [...new Set(resultado.map(s => s.trim()).filter(Boolean))];
  for (const nombre of nombres) {
    await supabase.from('lista_compra').insert([{ nombre, owner_id: uid || null, completado: false }]);
  }

  inputNombre.value = '';
  await cargarLista();
  await cargarPendientes();
  window.updateShoppingBadge?.();
});

// ================= Cargar lista =================
async function cargarLista() {
  const { data: lista, error } = await supabase
    .from('lista_compra')
    .select('id, nombre, completado, cantidad, unidad, created_at')
    .order('created_at', { ascending: true });
  if (error) { container.innerHTML = '<p>Error cargando lista.</p>'; return; }

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

  const { data: ingredientes } = await supabase
    .from('ingredientes_base')
    .select('nombre, supermercado, precio, cantidad, unidad');

  const mapaIngredientes = new Map();
  const supermercadosUnicos = new Set();
  const existentesSet = new Set((ingredientes || []).map(i => singular(nrm(i.nombre))));

  (ingredientes || []).forEach(i => {
    const key = singular(nrm(i.nombre));
    if (i.supermercado) supermercadosUnicos.add(i.supermercado);
    if (!mapaIngredientes.has(key)) mapaIngredientes.set(key, []);
    mapaIngredientes.get(key).push(i);
  });

  const prevSuper1 = supermercado1Select.value;
  const prevSuper2 = supermercado2Select.value;
  supermercado1Select.innerHTML = '<option value="">--Elige--</option>';
  supermercado2Select.innerHTML = '<option value="">--Elige--</option>';
  [...supermercadosUnicos].sort().forEach(s => {
    supermercado1Select.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
    supermercado2Select.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
  });
  if (prevSuper1 && supermercadosUnicos.has(prevSuper1)) supermercado1Select.value = prevSuper1; else if (supermercadosUnicos.has('Lidl')) supermercado1Select.value = 'Lidl';
  if (prevSuper2 && supermercadosUnicos.has(prevSuper2)) supermercado2Select.value = prevSuper2; else if (supermercadosUnicos.has('Mercadona')) supermercado2Select.value = 'Mercadona';
  if (supermercado1Select.options.length === 1) { supermercado1Select.innerHTML += '<option value="Lidl">Lidl</option>'; supermercado1Select.value = 'Lidl'; }
  if (supermercado2Select.options.length === 1) { supermercado2Select.innerHTML += '<option value="Mercadona">Mercadona</option>'; supermercado2Select.value = 'Mercadona'; }

  const super1 = supermercado1Select.value || null;
  const super2 = supermercado2Select.value || null;

  const toBase = (cant, uni) => {
    const n = Number(cant) || 0; const u = (uni || '').toLowerCase();
    if (u === 'kg') return { c: n * 1000, u: 'g' };
    if (u === 'g')  return { c: n,         u: 'g' };
    if (u === 'l')  return { c: n * 1000,  u: 'ml' };
    if (u === 'ml') return { c: n,         u: 'ml' };
    return { c: n, u: 'ud' };
  };

  const completados = [], pendientes = [];
  lista.forEach(it => (it.completado ? completados : pendientes).push(it));
  const ordenados = [...pendientes, ...completados];

  let total1 = 0, total2 = 0;
  const ul = document.createElement('ul');

  ordenados.forEach(item => {
    const key = singular(nrm(item.nombre));
    const coincidencias = mapaIngredientes.get(key) || [];
    const prod1 = coincidencias.find(i => i.supermercado === super1) || null;
    const prod2 = coincidencias.find(i => i.supermercado === super2) || null;
    const ref = prod1 || prod2 || coincidencias[0] || null;

    let packs = 1; let textoCantidad = '—';
    if (ref && ref.cantidad && (item.cantidad || item.unidad)) {
      const need = toBase(item.cantidad, item.unidad);
      const pack = toBase(ref.cantidad, ref.unidad);
      packs = pack.c > 0 ? Math.ceil(need.c / pack.c) : 1;
      textoCantidad = `${item.cantidad ?? ref.cantidad} ${item.unidad ?? ref.unidad}`;
      if (packs > 1) textoCantidad += ` · ≈${packs} pack${packs>1?'s':''}`;
    } else if (ref && ref.cantidad) {
      textoCantidad = `${ref.cantidad} ${ref.unidad}`;
    }

    const precio1 = prod1?.precio != null ? prod1.precio * packs : null;
    const precio2 = prod2?.precio != null ? prod2.precio * packs : null;
    if (precio1 != null) total1 += precio1;
    if (precio2 != null) total2 += precio2;

    const esIngrediente = existentesSet.has(key);
    const nombreClase = item.completado ? 'line-through text-gray-400' : (esIngrediente ? 'text-green-600 font-bold' : '');
    const clase1 = (precio1 != null && precio2 != null && precio1 < precio2) ? 'text-green-600 font-bold' : '';
    const clase2 = (precio1 != null && precio2 != null && precio2 < precio1) ? 'text-green-600 font-bold' : '';

    ul.insertAdjacentHTML('beforeend', `
      <li class="lista-item">
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
              <button class="boton-redondo boton-amarillo editar-btn" data-id="${item.id}" title="Editar"><i class="fas fa-edit"></i></button>
              <button class="boton-redondo boton-rojo borrar-btn" data-id="${item.id}" title="Borrar"><i class="fas fa-trash-alt"></i></button>
            </div>
          </div>
        </div>
      </li>`);
  });

  container.innerHTML = '';
  container.appendChild(ul);
  total1Span.textContent = total1.toFixed(2) + '€';
  total2Span.textContent = total2.toFixed(2) + '€';

  document.querySelectorAll('.borrar-btn').forEach(btn => btn.addEventListener('click', borrarItem));
  document.querySelectorAll('.editar-btn').forEach(btn => btn.addEventListener('click', editarItem));
  document.querySelectorAll('.completado-checkbox').forEach(cb => cb.addEventListener('change', async (e) => {
    const id = e.currentTarget.dataset.id;
    const completado = e.currentTarget.checked;
    await supabase.from('lista_compra').update({ completado }).eq('id', id);
    window.updateShoppingBadge?.();
    cargarLista(); cargarPendientes();
  }));
}

function borrarItem(e) {
  const id = e.currentTarget.dataset.id;
  supabase.from('lista_compra').delete().eq('id', id).then(() => {
    window.updateShoppingBadge?.();
    cargarLista(); cargarPendientes();
  });
}

function editarItem(e) {
  const id = e.currentTarget.dataset.id;
  const li = e.currentTarget.closest('li');
  if (li.classList.contains('editando')) return;
  li.classList.add('editando');
  const span = li.querySelector('.item-nombre');
  const nombre = span.textContent.trim();
  const form = document.createElement('form');
  form.classList.add('form-editar');
  form.innerHTML = `
    <input type="text" name="nombre" value="${nombre}" required class="editar-input">
    <button type="submit" class="editar-guardar" title="Guardar"><i class="fas fa-save"></i></button>
    <button type="button" class="editar-cancelar cancelar-edicion" title="Cancelar"><i class="fas fa-times"></i></button>`;
  span.replaceWith(form);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nuevoNombre = form.nombre.value.trim();
    await supabase.from('lista_compra').update({ nombre: nuevoNombre }).eq('id', id);
    li.classList.remove('editando');
    window.updateShoppingBadge?.();
    cargarLista(); cargarPendientes();
  });
  form.querySelector('.cancelar-edicion').addEventListener('click', () => { li.classList.remove('editando'); cargarLista(); });
}

// =========== Agregar completados a despensa ==========
document.getElementById('agregar-completados-despensa')?.addEventListener('click', async () => {
  const { data: completados } = await supabase
    .from('lista_compra')
    .select('*')
    .eq('completado', true);

  const uid = await getUidActual();

  for (const item of (completados || [])) {
    const { data: info } = await supabase
      .from('ingredientes_base')
      .select('cantidad, unidad')
      .eq('nombre', item.nombre)
      .maybeSingle();

    const cant = info?.cantidad ?? 1;
    const uni  = info?.unidad ?? 'ud';

    const { data: existe } = await supabase
      .from('despensa')
      .select('id, cantidad')
      .eq('nombre', item.nombre)
      .eq('unidad', uni)
      .maybeSingle();

    if (existe) {
      const nueva = (parseFloat(existe.cantidad) || 0) + (parseFloat(cant) || 0);
      await supabase.from('despensa').update({ cantidad: nueva }).eq('id', existe.id);
    } else {
      await supabase.from('despensa').insert([{ nombre: item.nombre, cantidad: cant, unidad: uni, owner_id: uid || null }]);
    }

    await supabase.from('lista_compra').delete().eq('id', item.id);
  }

  await cargarLista();
  await cargarPendientes();
  window.updateShoppingBadge?.();
});

// =========== Pendientes (vista rápida) ==========
async function cargarPendientes() {
  const { data: pendientes } = await supabase
    .from('despensa')
    .select('*')
    .order('created_at', { ascending: true });

  const cont = document.getElementById('pendientes-container');
  if (!cont) return;
  cont.innerHTML = pendientes?.length ? pendientes.map(p => `<div>${p.nombre}</div>`).join('') : '<p>No hay productos pendientes.</p>';
}

// =========== Init ==========
window.addEventListener('DOMContentLoaded', () => {
  cargarLista();
  cargarPendientes();
  window.updateShoppingBadge?.();
});
