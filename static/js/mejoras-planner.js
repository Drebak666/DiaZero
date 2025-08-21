import { supabase } from './supabaseClient.js';

/**
 * Planificador diario de mejoras
 * - No duplica porque usa onConflict (improvement_id, due_date)
 * - Respeta presupuestoMin y maxTareas
 * - Opcional: cuotasPorCategoria { "Código": 30, "Casa": 20, ... } en %
 */
export async function planificarMejorasHoy({
  presupuestoMin = 60,
  bloquesPermitidos = [25, 15, 45],
  maxTareas = 4,
  cuotasPorCategoria = null // e.g. { "Código": 40, "Lectura": 30, "Casa": 30 }
} = {}) {
  const usuario = localStorage.getItem('usuario_actual') || 'desconocido';
  const hoyStr = new Date().toISOString().split('T')[0];

  // 0) Evitar replanificar en el mismo día si ya hay algo planificado
  //    No es estrictamente necesario por el UNIQUE, pero ahorra trabajo.
  const { data: yaHay, error: errYaHay } = await supabase
    .from('tasks')
    .select('id')
    .eq('usuario', usuario)
    .eq('due_date', hoyStr)
    .not('improvement_id', 'is', null)
    .limit(1);

  if (!errYaHay && yaHay && yaHay.length > 0) {
    return { planned: 0, reason: 'already_planned_today' };
  }

  // 1) Leer backlog activo
  const { data: mejoras, error } = await supabase
    .from('mejoras')
    .select('*')
    .eq('usuario', usuario)
    .eq('is_active', true);

  if (error || !Array.isArray(mejoras) || mejoras.length === 0) {
    return { planned: 0, reason: 'no_backlog' };
  }

  // 2) Filtrar por cooldown: si last_done_at + cooldown > hoy -> saltar
  const hoy = new Date(hoyStr);
  const candidatas = mejoras.filter(m => {
    if (!m.cooldown_dias || m.cooldown_dias <= 0 || !m.last_done_at) return true;
    const last = new Date(m.last_done_at);
    const nextAllowed = new Date(last);
    nextAllowed.setDate(nextAllowed.getDate() + m.cooldown_dias);
    return nextAllowed <= hoy;
  });

  if (candidatas.length === 0) return { planned: 0, reason: 'cooldown_all' };

  // 3) Scoring simple
  const scoreDe = (m) => {
    const prioridad = Number(m.prioridad || 3); // 1..5
    // días desde última vez hecha
    let diasIdle = 999;
    if (m.last_done_at) {
      const last = new Date(m.last_done_at);
      diasIdle = Math.max(0, Math.round((hoy - last) / (1000 * 60 * 60 * 24)));
    }
    // penalizar si fue ayer
    const penalAyer = (diasIdle === 0) ? -5 : 0;
    const jitter = Math.random(); // romper empates
    return prioridad * 10 + diasIdle + penalAyer + jitter;
  };

  // 4) Ordenar por score desc
  candidatas.sort((a, b) => scoreDe(b) - scoreDe(a));

  // 5) Selección por presupuesto + cuotas + bloques permitidos
  const minutosPorCategoria = {};
  const metaPorCategoria = {};
  if (cuotasPorCategoria && typeof cuotasPorCategoria === 'object') {
    const totalPct = Object.values(cuotasPorCategoria).reduce((s, x) => s + Number(x || 0), 0);
    if (totalPct > 0) {
      for (const [cat, pct] of Object.entries(cuotasPorCategoria)) {
        metaPorCategoria[cat] = Math.floor((Number(pct) / 100) * presupuestoMin);
      }
    }
  }

  let restante = presupuestoMin;
  const elegidas = [];

  for (const m of candidatas) {
    if (elegidas.length >= maxTareas) break;
    if (restante <= 0) break;

    const bloque = Number(m.esfuerzo_min || 25);
    if (!bloquesPermitidos.includes(bloque)) continue; // si no está permitido, saltar
    if (bloque > restante) continue;

    // comprobar cuota
    if (metaPorCategoria && Object.keys(metaPorCategoria).length > 0) {
      const cat = m.categoria || 'General';
      const usado = minutosPorCategoria[cat] || 0;
      const meta = metaPorCategoria[cat] ?? presupuestoMin; // si no hay cuota para esa cat, sin límite
      if (usado + bloque > meta) {
        // si excede su cuota, solo la aceptamos si no hay otras dentro de cuota
        // (regla simple: dejamos pasar una por categoría si no hemos llenado presupuesto con nadie)
        const hayOtraEnCuota = candidatas.some(x => {
          if (x === m) return false;
          const cat2 = x.categoria || 'General';
          const usado2 = minutosPorCategoria[cat2] || 0;
          const meta2 = metaPorCategoria[cat2] ?? presupuestoMin;
          const bloque2 = Number(x.esfuerzo_min || 25);
          return bloquesPermitidos.includes(bloque2) && bloque2 <= restante && (usado2 + bloque2) <= meta2 && !elegidas.includes(x);
        });
        if (hayOtraEnCuota) continue;
      }
      minutosPorCategoria[cat] = usado + bloque;
    }

    elegidas.push(m);
    restante -= bloque;
  }

  if (elegidas.length === 0) return { planned: 0, reason: 'no_fit_budget' };

  // 6) Crear/actualizar tareas de hoy (upsert por improvement_id+due_date)
  const rows = elegidas.map(m => ({
    usuario,
    description: `[Mejora] ${m.titulo}`,
    due_date: hoyStr,
    is_completed: false,
    priority: m.prioridad ?? 2,
    improvement_id: m.id
  }));

  const { error: upErr } = await supabase
    .from('tasks')
    .upsert(rows, { onConflict: 'improvement_id,due_date' });

  if (upErr) {
    console.error('❌ Error planificando mejoras:', upErr);
    return { planned: 0, reason: 'upsert_error' };
  }

  // (opcional) Marcar last_planned_at en mejoras elegidas
  const idsElegidas = elegidas.map(m => m.id);
  const { error: updErr } = await supabase
    .from('mejoras')
    .update({ last_planned_at: hoyStr })
    .in('id', idsElegidas);
  if (updErr) console.warn('⚠️ No se pudo actualizar last_planned_at:', updErr);

  return { planned: rows.length, reason: 'ok' };
}
