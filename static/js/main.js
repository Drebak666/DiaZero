// static/js/main.js
import { supabase } from './supabaseClient.js';

// Normaliza unidades a base (g, ml, ud)
function toBase(cant, uni) {
  const n = parseFloat(cant) || 0;
  const u = (uni || '').toLowerCase();
  if (u === 'kg') return { cant: n * 1000, uni: 'g' };
  if (u === 'g')  return { cant: n,       uni: 'g' };
  if (u === 'l')  return { cant: n * 1000, uni: 'ml' };
  if (u === 'ml') return { cant: n,        uni: 'ml' };
  return { cant: n, uni: 'ud' };
}
function fromBase(n, baseUni, targetUni) {
  const u = (targetUni || '').toLowerCase();
  if (baseUni === 'g'  && u === 'kg') return n / 1000;
  if (baseUni === 'ml' && u === 'l')  return n / 1000;
  return n; // g→g, ml→ml, ud→ud
}

// Devuelve la cantidad mínima (en unidad base) que cubre el déficit usando packs disponibles.
// Minimiza: 1) exceso sobre el déficit, 2) nº de packs, 3) prefiere packs pequeños en empates.
function cubrirMinimo(deficitBase, packsBase) {
  packsBase = [...new Set(packsBase.filter(x => x > 0))].sort((a,b)=>a-b);
  if (!packsBase.length) return Math.ceil(deficitBase); // sin info: compra justo lo necesario

  const maxPack = packsBase[packsBase.length - 1];
  const LIM = deficitBase + maxPack; // margen para superar déficit
  const INF = 1e15;

  // DP: best[x] = [exceso, numPacks, ultimoPack] para conseguir cantidad x (base)
  const best = Array(LIM + 1).fill(null);
  best[0] = [deficitBase, 0, -1]; // a 0 le falta deficitBase (exceso considerado como "faltante")

  for (let x = 0; x <= LIM; x++) {
    if (!best[x]) continue;
    for (const p of packsBase) {
      const y = x + p;
      if (y > LIM) continue;
      const exceso = Math.max(0, y - deficitBase);
      const cand = [exceso, best[x][1] + 1, p];
      const cur  = best[y];

      // orden lexicográfico: menor exceso, luego menos packs, luego pack más pequeño
      const mejor = !cur ||
        cand[0] < cur[0] ||
        (cand[0] === cur[0] && cand[1] < cur[1]) ||
        (cand[0] === cur[0] && cand[1] === cur[1] && cand[2] < cur[2]);

      if (mejor) best[y] = cand;
    }
  }

  // elegir el y con mejor (exceso, packs, pack pequeño)
  let yBest = -1, meta = [INF, INF, INF];
  for (let y = deficitBase; y <= LIM; y++) {
    if (!best[y]) continue;
    const cand = best[y];
    const mejor = cand[0] < meta[0] ||
                 (cand[0] === meta[0] && cand[1] < meta[1]) ||
                 (cand[0] === meta[0] && cand[1] === meta[1] && cand[2] < meta[2]);
    if (mejor) { yBest = y; meta = cand; }
  }
  return yBest > 0 ? yBest : Math.ceil(deficitBase);
}


// Espera a que Supabase restaure la sesión (evita “Failed to fetch” y datos vacíos en primera carga)
async function ensureSessionReady() {
  try { await supabase.auth.getSession(); } catch {}
  await new Promise(r => setTimeout(r, 50));
}

// ==== UID global, pero tras asegurar sesión ====
await ensureSessionReady();
{
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id || null;
  window.UID = uid;
}

import { enablePush, sendTest as sendTestPush, unsubscribe as unsubscribePush } from '/static/js/push.js';
window.enablePush = enablePush;
window.sendTestPush = sendTestPush;
window.unsubscribePush = unsubscribePush;
console.log('push attach:', typeof window.enablePush); // debe decir "function"

document.addEventListener('DOMContentLoaded', async () => {
  // 1) sesión
  await ensureSessionReady();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/login'; return; }

  // 2) preparar despensa (rellena cantidad_total si está a null)
  await rellenarCantidadTotalEnDespensa();

  // 3) genera/actualiza lista de compra
  await verificarDespensaYActualizar();
await updateShoppingBadge();
  // 4) cuando cambie la despensa (al completar una comida, etc.)
  window.addEventListener('despensa-cambiada', async () => {
    await verificarDespensaYActualizar();
await updateShoppingBadge();
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

// ✅ contador unificado (usa count exacto y cuenta false o NULL)
// 🔧 Pega SOLO estos cambios mínimos

// 1) main.js → reemplaza updateShoppingBadge() por esto
async function updateShoppingBadge() {
  const { data:{ user } } = await supabase.auth.getUser();
  const uid = user?.id; if (!uid) return;

  const { count } = await supabase
    .from('lista_compra')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', uid)
    .or('completado.eq.false,completado.is.null');

  const total = count || 0;
  document.querySelectorAll('#contador-lista, .contador-lista').forEach(el => {
    el.textContent = total;
    el.style.display = total > 0 ? 'inline-block' : 'none';
  });
}
window.updateShoppingBadge = updateShoppingBadge;

document.addEventListener('DOMContentLoaded', () => {
  updateShoppingBadge();
});









async function verificarDespensaYActualizar() {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return 0;

  let añadidos = 0;

// A) evitar duplicados en lista_compra (pendientes del usuario)
const { data: listaActual } = await supabase
  .from('lista_compra')
  .select('id, nombre, completado')
  .eq('owner_id', uid); // ← quita el filtro .eq('completado', false)

const yaEnLista = new Set((listaActual || []).map(i => (i.nombre || '').toLowerCase().trim()));


  // B) STOCK BAJO GLOBAL (<15% del pack)
  const { data: despensaAll } = await supabase
    .from('despensa')
    .select('id, nombre, cantidad, unidad, cantidad_total')
    .eq('owner_id', uid);

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
        owner_id: uid,
        cantidad: d.cantidad_total ?? null,
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
  .or(`owner_id.eq.${uid},owner_id.is.null`);

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

  // ingredientes_base del usuario; si vacío, fallback sin filtro
  let { data: ingBase } = await supabase
    .from('ingredientes_base')
    .select('id, description, nombre, unidad, cantidad')
    .in('id', ingIds)
    .eq('owner_id', uid);
  if (!ingBase || !ingBase.length) {
    const alt = await supabase
      .from('ingredientes_base')
      .select('id, description, nombre, unidad, cantidad')
      .in('id', ingIds);
    ingBase = alt.data || [];
  }
  if (!ingBase.length) return añadidos;

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

  // Necesarios HOY (sumados × personas)
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

  // Lo disponible en despensa para esos nombres (del usuario)
  const nombresUnicos = [...new Set([...necesarios.keys()].map(k => k.split('|')[0]))];
  const { data: despensaRows } = await supabase
    .from('despensa')
    .select('id, nombre, cantidad, unidad, cantidad_total')
    .in('nombre', nombresUnicos)
    .eq('owner_id', uid);

  const disponibles = new Map();
  for (const d of (despensaRows || [])) {
    const { cant, uni } = toBase(d.cantidad, d.unidad);
    const key = `${d.nombre}|${uni}`;
    disponibles.set(key, (disponibles.get(key) || 0) + cant);
  }

  // Añadir faltantes a lista_compra (usuario = owner_id)
  for (const [key, cantNecesaria] of necesarios.entries()) {
    const [nombre, uniBase] = key.split('|');
    const cantDisp = disponibles.get(key) || 0;
    const deficit  = cantNecesaria - cantDisp;
    if (deficit <= 0) continue;

    const listaKey = nombre.toLowerCase().trim();
    if (yaEnLista.has(listaKey)) continue;

    // tamaño de pack
    let pack = null;

    // 1) pack desde despensa
    const drow = (despensaRows || []).find(x => (x.nombre || '').toLowerCase() === nombre.toLowerCase());
    if (drow && drow.cantidad_total != null) {
      const conv = toBase(drow.cantidad_total, drow.unidad);
      if (conv.uni === uniBase) pack = conv.cant;
    }

    // 2) pack desde ingredientes_base
const norm = s => (s || '').toLowerCase().trim();
const baseItem = ingBase.find(b => norm(b.description || b.nombre) === norm(nombre));
    if (pack == null && baseItem && baseItem.cantidad != null) {
      const conv = toBase(baseItem.cantidad, baseItem.unidad);
      if (conv.uni === uniBase) pack = conv.cant;
    }

    // 3) si no hay pack, compra exactamente el déficit
    if (!Number.isFinite(pack) || pack <= 0) pack = deficit;

    const cantidadFinal = Math.ceil(deficit / pack) * pack;

    await supabase.from('lista_compra').insert({
      nombre,
      owner_id: uid,
      unidad:  uniBase,
      cantidad: cantidadFinal,
      completado: false
    });

    yaEnLista.add(listaKey);
    añadidos++;
  }

  return añadidos;
}

async function rellenarCantidadTotalEnDespensa() {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return;

  // Items de despensa sin capacidad registrada
  const { data: despensa } = await supabase
    .from('despensa')
    .select('id, nombre, unidad')
    .is('cantidad_total', null)       // <- más claro que .or('cantidad_total.is.null')
    .eq('owner_id', uid);

  if (!despensa?.length) return;

  // conversor simple a unidad base
  const toBase = (cant, uni) => {
    const n = parseFloat(cant) || 0;
    const u = (uni || '').toLowerCase();
    if (u === 'kg') return { cant: n * 1000, uni: 'g' };
    if (u === 'g')  return { cant: n,       uni: 'g' };
    if (u === 'l')  return { cant: n * 1000, uni: 'ml' };
    if (u === 'ml') return { cant: n,        uni: 'ml' };
    return { cant: n, uni: 'ud' }; // por defecto
  };

  for (const item of despensa) {
    const { id, nombre, unidad: uniDesp } = item;

    // 1º buscar por nombre exacto
    let { data: base } = await supabase
      .from('ingredientes_base')
      .select('cantidad, unidad, nombre, description')
      .eq('owner_id', uid)
      .eq('nombre', nombre)
      .maybeSingle();

    // 2º si no hay, intentar por description
    if (!base) {
      const alt = await supabase
        .from('ingredientes_base')
        .select('cantidad, unidad, nombre, description')
        .eq('owner_id', uid)
        .eq('description', nombre)
        .maybeSingle();
      base = alt.data || null;
    }

    if (!base || base.cantidad == null) continue;

    // Solo fijar cantidad_total si las unidades son comparables
    const b = toBase(base.cantidad, base.unidad);
    const d = toBase(1, uniDesp); // solo para saber la unidad base de despensa

    if (b.uni !== d.uni) {
      // Unidades incompatibles: lo dejamos para que lo ajustes manualmente
      continue;
    }

    await supabase
      .from('despensa')
.update({ cantidad_total: b.cant }) // b.cant ya está en 'g' o 'ml' como d.uni
      .eq('id', id)
      .eq('owner_id', uid);
  }
}

window.verificarDespensaYActualizar = verificarDespensaYActualizar;
