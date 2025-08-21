// src/main.js
import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1) sesión
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/login'; return; }


  // 2) preparar despensa (rellena cantidad_total si está a null)
  await rellenarCantidadTotalEnDespensa();

  // 3) genera/actualiza lista de compra
  await verificarDespensaYActualizar();
  await actualizarContadorLista();

  // 4) cuando cambie la despensa (al completar una comida, etc.)
  window.addEventListener('despensa-cambiada', async () => {
    await verificarDespensaYActualizar();
    await actualizarContadorLista();
  });

  // ===== UI de usuario (igual que tenías) =====
  const guardado = localStorage.getItem('usuario_actual');
  if (guardado) {
    const radio = document.querySelector(`input[name="usuario"][value="${guardado}"]`);
    if (radio) radio.checked = true;
  }

  const rol = localStorage.getItem('rol_usuario');
  if (rol === 'admin') {
    console.log('👑 Modo administrador activado');
    document.body.classList.add('modo-admin');
    document.querySelectorAll('.solo-admin').forEach(el => el.classList.remove('oculto'));
  }

  const toggleBtn = document.getElementById('toggle-selector');
  const selector = document.getElementById('selector-usuario');
  if (toggleBtn && selector) {
    toggleBtn.addEventListener('click', () => selector.classList.toggle('oculto'));
    document.addEventListener('click', (e) => {
      if (!toggleBtn.contains(e.target) && !selector.contains(e.target)) {
        selector.classList.add('oculto');
      }
    });
  }

  const roles = { raul: 'admin', derek: 'user' };
  document.querySelectorAll('input[name="usuario"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const usuario = radio.value;
      localStorage.setItem('usuario_actual', usuario);
      localStorage.setItem('rol_usuario', roles[usuario.toLowerCase()] || 'user');
      location.reload();
    });
  });

  document.getElementById('cerrar-sesion')?.addEventListener('click', async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      localStorage.removeItem('usuario_actual');
      localStorage.removeItem('rol_usuario');
      sessionStorage.clear();
      window.location.href = '/login';
    }
  });
});

// =========================
// =   FUNCIONES GORDAS    =
// =========================

async function actualizarContadorLista() {
  const usuario = localStorage.getItem('usuario_actual');
  if (!usuario) return;
  const { data: items } = await supabase
    .from('lista_compra')
    .select('id')
    .eq('usuario', usuario)
    .eq('completado', false);

  const total = items?.length || 0;
  const badge = document.getElementById('contador-lista');
  if (badge) {
    badge.textContent = total;
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  }
}

async function verificarDespensaYActualizar() {
  const usuario = localStorage.getItem('usuario_actual');
  if (!usuario) return 0;

  let añadidos = 0;

  // A) evitar duplicados
  const { data: listaActual } = await supabase
    .from('lista_compra')
    .select('id, nombre, completado')
    .eq('usuario', usuario)
    .eq('completado', false);
  const yaEnLista = new Set((listaActual || []).map(i => (i.nombre || '').toLowerCase().trim()));

  // B) STOCK BAJO GLOBAL (<15% del pack)
  const { data: despensaAll } = await supabase
    .from('despensa')
    .select('id, nombre, cantidad, unidad, cantidad_total')
    .eq('usuario', usuario);

  for (const d of (despensaAll || [])) {
    const nombre = (d.nombre || '').trim();
    const total  = Number(d.cantidad_total);
    const actual = Number(d.cantidad);
    if (!nombre || !Number.isFinite(total) || total <= 0) continue;
    if (!Number.isFinite(actual) || actual < 0) continue;

    const ratio = actual / total;
    if (ratio < 0.15 && !yaEnLista.has(nombre.toLowerCase())) {
      await supabase.from('lista_compra').insert({
        nombre,
        usuario,
        cantidad: d.cantidad_total ?? null, // repón 1 pack
        unidad: d.unidad ?? null,
        completado: false
      });
      yaEnLista.add(nombre.toLowerCase());
      añadidos++;
    }
  }

  // C) DÉFICIT HOY × PERSONAS → redondeado a packs
  const hoy = new Date().toISOString().split('T')[0];

  const { data: comidasDia, error: errComidas } = await supabase
    .from('comidas_dia')
    .select('receta_id, personas')
    .eq('fecha', hoy)
    .eq('usuario', usuario);
  if (errComidas || !comidasDia?.length) return añadidos;

  const recetaIds = [...new Set(comidasDia.map(c => c.receta_id))];
  const personasPorReceta = new Map(
    comidasDia.map(c => [c.receta_id, Math.max(1, Number(c.personas) || 1)])
  );

  const { data: ingRecetas, error: errIng } = await supabase
    .from('ingredientes_receta')
    .select('receta_id, ingrediente_id, cantidad, unidad')
    .in('receta_id', recetaIds);
  if (errIng || !ingRecetas?.length) return añadidos;

  const ingIds = [...new Set(ingRecetas.map(i => i.ingrediente_id))];

  // ingredientes_base (primero por usuario; si está vacío, sin filtro)
  let { data: ingBase } = await supabase
    .from('ingredientes_base')
    .select('id, description, unidad, cantidad')
    .in('id', ingIds)
    .eq('usuario', usuario);
  if (!ingBase || !ingBase.length) {
    const alt = await supabase
      .from('ingredientes_base')
      .select('id, description, unidad, cantidad')
      .in('id', ingIds);
    ingBase = alt.data || [];
  }
  if (!ingBase.length) return añadidos;

  // helpers
  const byId = new Map(ingBase.map(i => [i.id, i]));
  const toBase = (cant, uni) => {
    const n = parseFloat(cant) || 0;
    const u = (uni || '').toLowerCase();
    if (u === 'kg') return { cant: n * 1000, uni: 'g' };
    if (u === 'g')  return { cant: n, uni: 'g' };
    if (u === 'l')  return { cant: n * 1000, uni: 'ml' };
    if (u === 'ml') return { cant: n, uni: 'ml' };
    return { cant: n, uni: 'ud' };
  };

  // Necesarios HOY (sumados × personas) -> clave: "nombre|uniBase"
  const necesarios = new Map();
  for (const r of ingRecetas) {
    const base = byId.get(r.ingrediente_id);
    if (!base) continue;
    const nombre = base.description || base.nombre || '';
    const { cant, uni } = toBase(r.cantidad, r.unidad);
    const mult = personasPorReceta.get(r.receta_id) || 1;
    const key = `${nombre}|${uni}`;
    necesarios.set(key, (necesarios.get(key) || 0) + (cant * mult));
  }

  // Lo disponible en despensa para esos nombres
  const nombresUnicos = [...new Set([...necesarios.keys()].map(k => k.split('|')[0]))];
  const { data: despensaRows } = await supabase
    .from('despensa')
    .select('id, nombre, cantidad, unidad, cantidad_total')
    .in('nombre', nombresUnicos)
    .eq('usuario', usuario);

  const disponibles = new Map();
  for (const d of (despensaRows || [])) {
    const { cant, uni } = toBase(d.cantidad, d.unidad);
    const key = `${d.nombre}|${uni}`;
    disponibles.set(key, (disponibles.get(key) || 0) + cant);
  }

  // Añadir faltantes (déficit redondeado al nº de packs necesarios)
  for (const [key, cantNecesaria] of necesarios.entries()) {
    const [nombre, uniBase] = key.split('|');
    const cantDisp = disponibles.get(key) || 0;
    const deficit  = cantNecesaria - cantDisp;
    if (deficit <= 0) continue;

    const listaKey = nombre.toLowerCase().trim();
    if (yaEnLista.has(listaKey)) continue;

    // tamaño de pack
    let pack = null;

    // 1) intento coger pack de despensa (cantidad_total)
    const drow = (despensaRows || []).find(x => (x.nombre || '').toLowerCase() === nombre.toLowerCase());
    if (drow && drow.cantidad_total != null) {
      const conv = toBase(drow.cantidad_total, drow.unidad);
      if (conv.uni === uniBase) pack = conv.cant;
    }

    // 2) si no hay, pack desde ingredientes_base
    const baseItem = ingBase.find(b => (b.description || b.nombre) === nombre);
    if (pack == null && baseItem && baseItem.cantidad != null) {
      const conv = toBase(baseItem.cantidad, baseItem.unidad);
      if (conv.uni === uniBase) pack = conv.cant;
    }

    // 3) última opción: compra exactamente el déficit
    if (!Number.isFinite(pack) || pack <= 0) pack = deficit;

    const cantidadFinal = Math.ceil(deficit / pack) * pack;

    await supabase.from('lista_compra').insert({
      nombre,
      usuario,
      unidad:  uniBase,        // 'g' / 'ml' / 'ud'
      cantidad: cantidadFinal, // déficit redondeado a packs
      completado: false
    });

    yaEnLista.add(listaKey);
    añadidos++;
  }

  return añadidos;
}

async function rellenarCantidadTotalEnDespensa() {
  // Rellena cantidad_total en despensa con el “pack” del ingrediente base si está a null
  const { data: despensa, error } = await supabase
    .from('despensa')
    .select('id, nombre')
    .is('cantidad_total', null);
  if (error || !despensa?.length) return;

  for (const item of despensa) {
    const { id, nombre } = item;
    const { data: base } = await supabase
      .from('ingredientes_base')
      .select('cantidad, unidad')
      .eq('nombre', nombre)
      .maybeSingle();
    if (!base) continue;

    await supabase
      .from('despensa')
      .update({ cantidad_total: base.cantidad })
      .eq('id', id);
  }
}
