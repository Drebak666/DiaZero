// static/js/lista_compra.js — v10
console.log('lista_compra v10');

import { supabase } from './supabaseClient.js';
import { getUsuarioActivo } from './usuario.js';

const form = document.getElementById('form-lista');
const inputNombre = document.getElementById('nombre-item');
const container = document.getElementById('lista-compra-container');

const supermercado1Select = document.getElementById('super1');
const supermercado2Select = document.getElementById('super2');
const total1Span = document.getElementById('total-super1');
const total2Span = document.getElementById('total-super2');

// -------- Helpers sesión / uid
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

// ======================= Datalist con packs/precios (vista "ingredientes")
const dl = document.createElement('datalist');
dl.id = 'ingredientes-sugerencias';
document.body.appendChild(dl);
inputNombre?.setAttribute('list', dl.id);

function debounce(fn, ms = 150) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Mapa: texto mostrado -> { nombre, packCant, packUnd, supermercado, precio }
const sugerenciasMap = new Map();

const actualizarSugerencias = debounce(async () => {
  const q = (inputNombre.value || '').trim();
  if (!q) { dl.innerHTML = ''; sugerenciasMap.clear(); return; }

  // Vista "ingredientes" (base + supermercado + último precio por pack)
  const { data: rows, error } = await supabase
    .from('ingredientes')
    .select('description, supermercado, precio, cantidad, unidad, fecha_precio')
    .ilike('description', `%${q}%`)
    .order('fecha_precio', { ascending: false })
    .limit(50);

  dl.innerHTML = '';
  sugerenciasMap.clear();
  if (error || !Array.isArray(rows)) return;

  const seen = new Set();
  for (const r of rows) {
    const nombre   = (r.description || '').trim();
    const packCant = r.cantidad;
    const packUnd  = r.unidad;
    const superm   = r.supermercado || '';
    const etiqueta = (packCant && packUnd)
      ? `${nombre} — ${packCant} ${packUnd} (${superm}) ${Number(r.precio).toFixed(2)}€`
      : `${nombre}`;
    if (seen.has(etiqueta)) continue;
    seen.add(etiqueta);

    const opt = document.createElement('option');
    opt.value = etiqueta; // Chrome muestra el value
    dl.appendChild(opt);

    sugerenciasMap.set(etiqueta, {
      nombre,
      packCant: packCant || null,
      packUnd:  packUnd  || null,
      supermercado: superm || null,
      precio: r.precio ?? null
    });
  }
}, 150);

inputNombre?.addEventListener('input', actualizarSugerencias);

// ======================= Añadir a la lista (no trocear nombres largos)
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = (inputNombre.value || '').trim();
  if (!texto) return;

  const uid = await getUidActual();

  // Solo separa por comas o conjunción (y/e)
  const partes = texto
    .replace(/\s+y\s+|\s+e\s+/gi, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (const raw of partes) {
    const sug = sugerenciasMap.get(raw);
    const nombre = sug?.nombre || raw;

    const insert = {
      nombre,
      owner_id: uid || null,
      completado: false
    };

    // Si el usuario eligió una opción del datalist con pack, la guardamos
    if (sug?.packCant && sug?.packUnd) {
      insert.cantidad = sug.packCant;
      insert.unidad   = sug.packUnd;
    }

    await supabase.from('lista_compra').insert([insert]);
  }

  inputNombre.value = '';
  await cargarLista();
  await cargarPendientes();
  window.updateShoppingBadge?.();
});

// ======================= Utilidades de ofertas / claves
const makeKey = (nombre, superm, cant, und) =>
  `${singular(nrm(nombre))}|${(superm||'').toLowerCase()}|${cant ?? ''}|${(und||'').toLowerCase()}`;

// Si el ítem se guardó con el texto del datalist, lo normalizamos
function parseNombreConEtiqueta(nombreCrudo) {
  // Ej: "Aceite ... — 1000 ml (Mercadona) 4,65€"
  const out = { base: nombreCrudo.trim(), cant: null, und: null };
  const parts = nombreCrudo.split('—');
  if (parts.length >= 2) {
    const base = parts[0].trim();
    const resto = parts.slice(1).join('—').trim(); // "1000 ml (Mercadona) 4,65€"
    const pack = resto.split('(')[0].trim();       // "1000 ml"
    const m = pack.match(/(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/);
    if (m) {
      out.base = base;
      out.cant = Number(String(m[1]).replace(',', '.'));
      out.und  = m[2].toLowerCase();
    }
  }
  return out;
}

// ======================= Cargar / renderizar lista
async function cargarLista() {
  const { data: lista, error } = await supabase
  .from('lista_compra')
  .select('id, nombre, completado, cantidad, unidad, created_at')
  .order('completado', { ascending: true }) // primero los no completados
  .order('created_at', { ascending: true }); // luego por fecha


  if (error) {
    container.innerHTML = '<p>Error cargando la lista.</p>';
    return;
  }

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

  // Ofertas (vista "ingredientes"): nombre (description), super, precio, pack
  const { data: ingredientes } = await supabase
    .from('ingredientes')
    .select('description, supermercado, precio, cantidad, unidad, fecha_precio')
    .order('fecha_precio', { ascending: false });

  // Mapa clave → precio (nos quedamos con el más reciente)
  const ofertasMap = new Map();
  const superSet = new Set();

  (ingredientes || []).forEach(r => {
    const key = makeKey(r.description || '', r.supermercado, r.cantidad, r.unidad);
    if (!ofertasMap.has(key)) {
      ofertasMap.set(key, Number(r.precio));
    }
    if (r.supermercado) superSet.add(r.supermercado);
  });

  // Rellenar selects de supermercados (manteniendo selección)
  const prev1 = supermercado1Select.value;
  const prev2 = supermercado2Select.value;
  supermercado1Select.innerHTML = '<option value="">--Elige--</option>';
  supermercado2Select.innerHTML = '<option value="">--Elige--</option>';
  [...superSet].sort().forEach(s => {
    supermercado1Select.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
    supermercado2Select.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
  });
  if (prev1 && superSet.has(prev1)) supermercado1Select.value = prev1; else if (superSet.has('Lidl')) supermercado1Select.value = 'Lidl';
  if (prev2 && superSet.has(prev2)) supermercado2Select.value = prev2; else if (superSet.has('Mercadona')) supermercado2Select.value = 'Mercadona';

  // Render
  let total1 = 0, total2 = 0;
  const ul = document.createElement('ul');
  ul.className = 'lista-compra';

  lista.forEach(item => {
    // Nombre/cantidad para mostrar y para buscar ofertas
    let baseName = item.nombre;
    let cant = item.cantidad ?? null;
    let und  = item.unidad   ?? null;

    // Si no hay pack guardado y el nombre viene con etiqueta de datalist, parsea
    if (!cant || !und) {
      const parsed = parseNombreConEtiqueta(item.nombre);
      if (parsed.base) baseName = parsed.base;
      if (parsed.cant) cant = parsed.cant;
      if (parsed.und)  und  = parsed.und;
    }

    // Precio por pack EXACTO del ítem (si lo tiene) y súper seleccionado
    const key1 = makeKey(baseName, supermercado1Select.value, cant, und);
    const key2 = makeKey(baseName, supermercado2Select.value, cant, und);

    let precio1 = ofertasMap.get(key1);
    let precio2 = ofertasMap.get(key2);

    // Fallback: si no hay pack, busca cualquier pack del nombre en ese súper
    if ((precio1 == null) && (!cant || !und)) {
      const pref = `${singular(nrm(baseName))}|${(supermercado1Select.value||'').toLowerCase()}|`;
      const hit = [...ofertasMap.entries()].find(([k]) => k.startsWith(pref));
      if (hit) precio1 = hit[1];
    }
    if ((precio2 == null) && (!cant || !und)) {
      const pref = `${singular(nrm(baseName))}|${(supermercado2Select.value||'').toLowerCase()}|`;
      const hit = [...ofertasMap.entries()].find(([k]) => k.startsWith(pref));
      if (hit) precio2 = hit[1];
    }

    if (precio1 != null) total1 += Number(precio1) || 0;
    if (precio2 != null) total2 += Number(precio2) || 0;

    const nombreClase = item.completado ? 'tachado' : '';
    const textoCantidad = (cant && und) ? `${cant} ${und}` : '—';
    const clase1 = precio1 != null ? '' : 'precio-vacio';
    const clase2 = precio2 != null ? '' : 'precio-vacio';

    ul.insertAdjacentHTML('beforeend', `
      <li class="lista-item">
        <div class="item-linea">
          <div class="item-izquierda">
            <input type="checkbox" class="completado-checkbox" data-id="${item.id}" ${item.completado ? 'checked' : ''}>
            <div class="item-nombre-cantidad">
              <span class="item-nombre ${nombreClase}">${baseName}</span>
              <span class="item-cantidad">${textoCantidad}</span>
            </div>
          </div>
          <div class="item-derecha">
            <span class="item-precio ${clase1}">${precio1 != null ? Number(precio1).toFixed(2) + '€' : '—'}</span>
            <span class="item-precio ${clase2}">${precio2 != null ? Number(precio2).toFixed(2) + '€' : '—'}</span>
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
  total1Span.textContent = (Number(total1).toFixed(2)) + '€';
  total2Span.textContent = (Number(total2).toFixed(2)) + '€';

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

// =========== Pasar completados a despensa ==========
// =========== Pasar completados a despensa ==========
document.getElementById('agregar-completados-despensa')?.addEventListener('click', async () => {
  const { data: completados } = await supabase
    .from('lista_compra')
    .select('*')
    .eq('completado', true);

  const uid = await getUidActual();

  for (const item of (completados || [])) {
    // intenta recuperar cantidad/unidad desde ficha base como fallback
    const { data: info } = await supabase
      .from('ingredientes_base')
      .select('cantidad, unidad')
      .ilike('nombre', item.nombre)
      .maybeSingle();

    const parsed = parseNombreConEtiqueta(item.nombre);
    const cant = item.cantidad ?? parsed.cant ?? info?.cantidad ?? 1;
    const uni  = item.unidad   ?? parsed.und  ?? info?.unidad   ?? 'ud';
    const nombreFinal = parsed.base || item.nombre;

    // Leer fila existente en despensa (trae cantidad y cantidad_total)
    const { data: existe } = await supabase
      .from('despensa')
      .select('id, cantidad, cantidad_total, unidad')
      .eq('nombre', nombreFinal)
      .eq('unidad', uni)
      .maybeSingle();

    if (existe) {
      // Sumamos a la cantidad actual y también al total "a tope"
      const nuevaCantidad = (parseFloat(existe.cantidad) || 0) + (parseFloat(cant) || 0);
      const nuevoTotal    = (parseFloat(existe.cantidad_total) || 0) + (parseFloat(cant) || 0);

      await supabase.from('despensa')
        .update({ cantidad: nuevaCantidad, cantidad_total: nuevoTotal })
        .eq('id', existe.id);
    } else {
      // Primera vez en despensa: cantidad y total valen lo comprado
      await supabase.from('despensa').insert([{
        nombre: nombreFinal,
        cantidad: cant,
        cantidad_total: cant,
        unidad: uni,
        owner_id: uid || null
      }]);
    }

    // Borrar de la lista de la compra
    await supabase.from('lista_compra').delete().eq('id', item.id);
  }

  await cargarLista();
  await cargarPendientes();
  window.updateShoppingBadge?.();
});


// =========== Pendientes (mini vista)
async function cargarPendientes() {
  const { data: pendientes } = await supabase
    .from('despensa')
    .select('*')

  const cont = document.getElementById('pendientes-container');
  if (!cont) return;
  cont.innerHTML = pendientes?.length ? pendientes.map(p => `<div>${p.nombre}</div>`).join('') : '<p>No hay productos pendientes.</p>';
}

// =========== Init
window.addEventListener('DOMContentLoaded', () => {
  cargarLista();
  cargarPendientes();
  window.updateShoppingBadge?.();
});
