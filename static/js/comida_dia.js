// static/js/comida_dia.js
import { supabase } from './supabaseClient.js';
import { calcularTotalesReceta } from '../utils/calculos_ingredientes.js';
import { getUsuarioActivo } from './usuario.js';

// --- helper: espera a que supabase restaure la sesión (evita "Failed to fetch")
async function ensureSessionReady() {
  try { await supabase.auth.getSession(); } catch {}
  await new Promise(r => setTimeout(r, 50));
}

// --- conversión simple a unidad base
function toBase(cant, uni) {
  const n = parseFloat(cant) || 0;
  const u = (uni || '').toLowerCase();
  if (u === 'kg') return { cant: n * 1000, uni: 'g' };
  if (u === 'g')  return { cant: n,       uni: 'g' };
  if (u === 'l')  return { cant: n * 1000, uni: 'ml' };
  if (u === 'ml') return { cant: n,        uni: 'ml' };
  return { cant: n, uni: (u || 'ud') };
}

document.addEventListener('DOMContentLoaded', async () => {
  await ensureSessionReady(); // 👈 muy importante
  const contenedor = document.getElementById('comida-container');
  if (!contenedor) return;

  const tipos = ['Desayuno', 'Comida', 'Cena'];
  let tipoActual = calcularTipoComida();

  function calcularTipoComida() {
    const hora = new Date().getHours();
    if (hora < 12) return 'Desayuno';
    if (hora < 18) return 'Comida';
    return 'Cena';
  }

  function cambiarTipo(direccion) {
    let idx = tipos.indexOf(tipoActual);
    idx = (idx + direccion + tipos.length) % tipos.length;
    tipoActual = tipos[idx];
    cargarComidaDelDia();
  }

  // ===== Modal Compartir: handlers globales (una sola vez) =====
  let _shareModalReady = false;
  function initShareModalHandlers() {
    if (_shareModalReady) return;
    _shareModalReady = true;

    const modal     = document.getElementById('modal-compartir');
    const form      = document.getElementById('form-compartir');
    const btnClear  = document.getElementById('share-clear');
    const btnCancel = document.getElementById('share-cancel');

    if (!modal) return;

    btnCancel?.addEventListener('click', () => modal.classList.add('oculto'));

    // Limpia compartidos de TODAS las comidas pasadas en share-ids (CSV)
    btnClear?.addEventListener('click', async () => {
      const idsCSV = document.getElementById('share-ids')?.value || '';
      const comidaIds = idsCSV.split(',').map(s => s.trim()).filter(Boolean);
      if (!comidaIds.length) return;

      const { error } = await supabase
        .from('comidas_compartidas')
        .delete()
        .in('comida_id', comidaIds);
      if (error) { console.error(error); return; }

      document.getElementById('share-grupo').value = '';
      document.getElementById('share-personas').innerHTML = '';
    });

    // Guarda compartidos para TODAS las comidas de la lista
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const idsCSV = document.getElementById('share-ids')?.value || '';
      const comidaIds = idsCSV.split(',').map(s => s.trim()).filter(Boolean);
      if (!comidaIds.length) return;

      const grupoId  = document.getElementById('share-grupo').value || null;

      const seleccionados = Array.from(
        document.querySelectorAll('#share-personas input[name="share-miembro"]:checked')
      ).map(ch => ch.value);

      // Para simplicidad: borramos todo y reinsertamos para esas comidas
      const del = await supabase.from('comidas_compartidas').delete().in('comida_id', comidaIds);
      if (del.error) { console.error(del.error); return; }

      const aInsertar = [];
      for (const comidaId of comidaIds) {
        for (const mid of seleccionados) {
          aInsertar.push({ comida_id: comidaId, grupo_id: grupoId, miembro_id: mid });
        }
      }
      if (aInsertar.length) {
        const ins = await supabase.from('comidas_compartidas').insert(aInsertar);
        if (ins.error) { console.error(ins.error); return; }
      }

      document.getElementById('modal-compartir').classList.add('oculto');
    });
  }
  initShareModalHandlers();
  // =============================================================

  async function cargarComidaDelDia() {
    await ensureSessionReady(); // 👈 asegura sesión antes de cada tanda de lecturas

    const hoy = new Date().toISOString().split('T')[0];
    const usuario = getUsuarioActivo();

    // === UID del usuario activo ===
    let usuarioId = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) usuarioId = user.id;
    } catch (_) {}
    if (!usuarioId) {
      const { data: uRow } = await supabase
        .from('usuarios')
        .select('id')
        .eq('username', usuario)
        .maybeSingle();
      if (uRow?.id) usuarioId = uRow.id;
    }

    contenedor.innerHTML = '';

    // ----- Header tipo + flechas -----
    const headerTipo = document.createElement('div');
    headerTipo.classList.add('comida-tipo-header');
    headerTipo.innerHTML = `
      <button class="flecha-roja" id="comida-prev">⬅</button>
      <span class="titulo-comida">🍽️ ${tipoActual} del día</span>
      <button class="flecha-roja" id="comida-next">➡</button>
    `;
    contenedor.appendChild(headerTipo);
    document.getElementById('comida-prev').onclick = () => cambiarTipo(-1);
    document.getElementById('comida-next').onclick = () => cambiarTipo(1);

    // ----- 1) Comidas propias -----
    const own = await supabase
      .from('comidas_dia')
      .select(`
        id, is_completed, tipo, receta_id, personas, owner_id,
        recetas (
          nombre,
          ingredientes_receta!fk_ir_receta ( cantidad, unidad, ingrediente_id )
        )
      `)
      .eq('fecha', hoy)
      .eq('tipo', tipoActual)
      .eq('owner_id', usuarioId);

    // ----- 2) Comidas compartidas conmigo (por UID) -----
    let shared = { data: [], error: null };
    if (usuarioId) {
      const mg = await supabase
        .from('miembros_grupo')
        .select('id')
        .eq('usuario_id', usuarioId);
      const miembroIds = (mg.data || []).map(r => r.id);

      if (miembroIds.length) {
        const comp = await supabase
          .from('comidas_compartidas')
          .select('comida_id')
          .in('miembro_id', miembroIds);

        const comidaIds = [...new Set((comp.data || []).map(r => r.comida_id))];

        if (comidaIds.length) {
          shared = await supabase
            .from('comidas_dia')
            .select(`
              id, is_completed, tipo, receta_id, personas, owner_id,
              recetas (
                nombre,
                ingredientes_receta ( cantidad, unidad, ingrediente_id )
              )
            `)
            .in('id', comidaIds)
            .eq('fecha', hoy)
            .eq('tipo', tipoActual);
        }
      }
    }

    if (own.error)   console.error('Error comidas propias:', own.error?.message);
    if (shared.error) console.error('Error comidas compartidas:', shared.error?.message);

    // Unir resultados sin duplicar
    const mapa = new Map();
    (own.data || []).forEach(r => mapa.set(r.id, r));
    (shared.data || []).forEach(r => mapa.set(r.id, r));
    const platos = Array.from(mapa.values());

    if (!platos.length) {
      contenedor.innerHTML += `<p>No hay ${tipoActual.toLowerCase()} planeado para hoy.</p>`;
      return;
    }

    // ===== personas únicas para toda la comida (usa el valor del 1º plato)
    let personasComida = Math.max(1, Number(platos[0]?.personas) || 1);

    // ===== ingredientes_base para TODOS los platos
    const allIngIds = [...new Set(
      platos.flatMap(p => (p.recetas?.ingredientes_receta || []).map(ir => ir.ingrediente_id))
    )];
    const ingBaseMap = new Map();
    if (allIngIds.length) {
      let { data: ingData } = await supabase
        .from('ingredientes_base')
        .select('id, description, precio, cantidad, calorias, proteinas, unidad')
        .in('id', allIngIds)
        .eq('owner_id', usuarioId);
      if (!ingData || !ingData.length) {
        const alt = await supabase
          .from('ingredientes_base')
          .select('id, description, precio, cantidad, calorias, proteinas, unidad')
          .in('id', allIngIds);
        ingData = alt.data || [];
      }
      (ingData || []).forEach(i => ingBaseMap.set(i.id, i));
    }

    // ===== totales de toda la comida (sumatoria × personas)
    let sumPrecio = 0, sumKcal = 0, sumProt = 0;
    for (const p of platos) {
      const tot = calcularTotalesReceta
        ? calcularTotalesReceta(p.recetas?.ingredientes_receta || [], ingBaseMap)
        : { totalCalorias: 0, totalProteinas: 0, totalPrecio: 0 };
      sumPrecio += (tot.totalPrecio || 0) * personasComida;
      sumKcal   += (tot.totalCalorias || 0) * personasComida;
      sumProt   += (tot.totalProteinas || 0) * personasComida;
    }

    // ===== CONTROLES ÚNICOS (personas + compartir + completar)
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.gap = '10px';
    controls.style.margin = '10px 0';

    // personas
    const personasLbl = document.createElement('span');
    personasLbl.textContent = '👥';

    const personasInput = document.createElement('input');
    personasInput.type = 'number';
    personasInput.min = '1';
    personasInput.max = '12';
    personasInput.value = String(personasComida);
    personasInput.classList.add('personas-input');
    personasInput.style.width = '58px';
    personasInput.onchange = async () => {
      const val = Math.max(1, parseInt(personasInput.value) || 1);
      personasComida = val;
      // Actualiza TODAS las filas de ese tipo y día del owner
      await supabase.from('comidas_dia')
        .update({ personas: val })
        .eq('fecha', hoy)
        .eq('tipo', tipoActual)
        .eq('owner_id', usuarioId);
      cargarComidaDelDia();
    };

    // compartir (pequeño)
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'icon-button share btn-share';
    shareBtn.title = 'Compartir';
    shareBtn.innerHTML = '<i class="fas fa-share-nodes"></i>';
    shareBtn.style.transform = 'scale(0.9)';

    shareBtn.addEventListener('click', async () => {
      await ensureSessionReady();
      const modal = document.getElementById('modal-compartir');
      if (!modal) return;

      // PASAMOS TODOS LOS IDs de comidas de este tipo en un hidden CSV
      const idsCSV = platos.map(p => p.id).join(',');
      const shareIds = document.getElementById('share-ids');
      if (shareIds) shareIds.value = idsCSV;

      // precarga: si hay compartidos en cualquiera, marcamos los que más se repiten (heurística simple)
      const { data: comp } = await supabase
        .from('comidas_compartidas')
        .select('comida_id, grupo_id, miembro_id')
        .in('comida_id', platos.map(p => p.id));

      const preSelMiembros = new Set((comp || []).map(r => r.miembro_id));
      const preSelGrupo = comp?.[0]?.grupo_id || '';

      const grupoSelect = document.getElementById('share-grupo');
      const personasDiv = document.getElementById('share-personas');
      if (!grupoSelect || !personasDiv) return;

      // cargar grupos
      grupoSelect.innerHTML = '<option value="">— Ninguno —</option>';
      const { data: grupos } = await supabase
        .from('grupos')
        .select('id, nombre')
        .order('nombre', { ascending: true });
      (grupos || []).forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.nombre;
        grupoSelect.appendChild(opt);
      });

      // al cambiar grupo, listamos miembros (como ya tenías)
      grupoSelect.onchange = async () => {
        personasDiv.innerHTML = '';
        const grupoId = grupoSelect.value;
        if (!grupoId) return;

        const { data: miembros } = await supabase
          .from('miembros_grupo')
          .select('id, usuario_id')
          .eq('grupo_id', grupoId);

        const ids = (miembros || []).map(m => m.usuario_id);
        let usuarios = [];
        if (ids.length) {
          const res = await supabase
            .from('usuarios')
            .select('id, email, username')
            .in('id', ids);
          usuarios = res.data || [];
        }
        const byId = new Map(usuarios.map(u => [u.id, u]));

        (miembros || []).forEach(m => {
          const u = byId.get(m.usuario_id);
          const labelTxt = u?.email || u?.username || (m.usuario_id?.slice(0, 8) + '…');

          const label = document.createElement('label');
          label.style.display = 'block';

          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.name = 'share-miembro';
          chk.value = m.id;
          chk.checked = preSelMiembros.has(m.id);

          label.appendChild(chk);
          label.append(' ' + labelTxt);
          personasDiv.appendChild(label);
        });
      };

      if (preSelGrupo) {
        grupoSelect.value = preSelGrupo;
        await grupoSelect.onchange();
      } else {
        personasDiv.innerHTML = '';
      }

      modal.classList.remove('oculto');
    });

    // completar toda la comida
    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.className = 'check-small';
    const allCompleted = platos.every(p => !!p.is_completed);
    completeBtn.innerHTML = allCompleted ? '✅' : '⭕';

    completeBtn.onclick = async () => {
      const nuevoEstado = !allCompleted;

      if (nuevoEstado) {
        // Descontar ingredientes de TODOS los platos × personas
        for (const plato of platos) {
          const mult = Math.max(1, Number(plato.personas ?? personasComida) || 1);
          const ingRec = plato.recetas?.ingredientes_receta || [];

          // mapa ingredientes_base para este plato (minimiza lecturas si ya cargado)
          const ids = ingRec.map(r => r.ingrediente_id);
          const baseLoc = ids.map(id => ingBaseMap.get(id)).filter(Boolean);
          const map = new Map(baseLoc.map(i => [i.id, i]));

          for (const ing of ingRec) {
            const base = map.get(ing.ingrediente_id);
            if (!base) continue;

            // cantidades en la unidad del ingrediente_base
            const cantRec = (parseFloat(ing.cantidad) || 0) * mult;
            const { cant: cantBase, uni: uniBase } = toBase(cantRec, ing.unidad || base.unidad);

            // restar en despensa solo si coincide la unidad base
            const { data: desp } = await supabase
              .from('despensa')
              .select('id, cantidad, unidad')
              .eq('nombre', base.description)
              .eq('unidad', uniBase)
              .eq('owner_id', usuarioId)
              .maybeSingle();

            if (!desp) continue;

            const actual = parseFloat(desp.cantidad) || 0;
            const nueva  = Math.max(0, actual - cantBase);
            await supabase
              .from('despensa')
              .update({ cantidad: nueva })
              .eq('id', desp.id)
              .eq('owner_id', usuarioId);
          }
        }

        // Marcar TODOS como completados
        await supabase
          .from('comidas_dia')
          .update({ is_completed: true })
          .eq('fecha', hoy)
          .eq('tipo', tipoActual)
          .eq('owner_id', usuarioId);
      } else {
        // Desmarcar TODOS (no reponemos stock)
        await supabase
          .from('comidas_dia')
          .update({ is_completed: false })
          .eq('fecha', hoy)
          .eq('tipo', tipoActual)
          .eq('owner_id', usuarioId);
      }

      window.dispatchEvent(new CustomEvent('despensa-cambiada'));
      cargarComidaDelDia();
    };

    controls.append(personasLbl, personasInput, shareBtn, completeBtn);
    contenedor.appendChild(controls);

    // ===== mostrar TOTALES de la comida
    const pTot = document.createElement('p');
    pTot.innerHTML = `
      <strong>Precio:</strong> ${sumPrecio.toFixed(2)} € |
      <strong>Calorías:</strong> ${Math.round(sumKcal)} kcal |
      <strong>Proteínas:</strong> ${Math.round(sumProt)} g
    `;
    contenedor.appendChild(pTot);

    // ===== tarjetas informativas de cada plato (sin controles propios)
    for (const plato of platos) {
      const card = document.createElement('div');
      card.classList.add('comida-card');

      const encabezado = document.createElement('div');
      encabezado.classList.add('comida-header');

      const nombre = document.createElement('h4');
      nombre.textContent = plato.recetas?.nombre || 'Receta';

      encabezado.appendChild(nombre);

      // lista de ingredientes × personas
      const lista = document.createElement('ul');
      lista.classList.add('ingredientes-lista');

      const mult = Math.max(1, Number(plato.personas ?? personasComida) || 1);
      (plato.recetas?.ingredientes_receta || []).forEach(ing => {
        const base = ingBaseMap.get(ing.ingrediente_id);
        if (!base) return;
        const cant = (parseFloat(ing.cantidad) || 0) * mult;
        const li = document.createElement('li');
        li.textContent = `${base.description}: ${cant} ${ing.unidad}`;
        lista.appendChild(li);
      });

      lista.style.display = 'none';

      const toggleIngredientes = document.createElement('button');
      toggleIngredientes.textContent = '🧾 Ver ingredientes';
      toggleIngredientes.classList.add('toggle-ingredientes');
      let visible = false;
      toggleIngredientes.onclick = () => {
        visible = !visible;
        lista.style.display = visible ? 'block' : 'none';
        toggleIngredientes.textContent = visible ? '🔽 Ocultar ingredientes' : '🧾 Ver ingredientes';
      };

      const cardTop = document.createElement('div');
      cardTop.append(encabezado, toggleIngredientes, lista);
      card.append(cardTop);
      contenedor.appendChild(card);
    }
  }
window.dispatchEvent(new CustomEvent('personas-cambiadas'));

  cargarComidaDelDia();
});
