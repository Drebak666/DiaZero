// static/js/comida_dia.js
import { supabase } from './supabaseClient.js';
import { calcularTotalesReceta } from '../utils/calculos_ingredientes.js';
import { getUsuarioActivo } from './usuario.js';

document.addEventListener('DOMContentLoaded', () => {
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

    // Cerrar modal
    btnCancel?.addEventListener('click', () => modal.classList.add('oculto'));

    // Quitar todo -> borra todos los compartidos de esa comida
    btnClear?.addEventListener('click', async () => {
      const comidaId = document.getElementById('share-id').value;
      if (!comidaId) return;
      const { error } = await supabase
        .from('comidas_compartidas')
        .delete()
        .eq('comida_id', comidaId);
      if (error) {
        alert('❌ No se pudo limpiar');
        return;
      }
      document.getElementById('share-grupo').value = '';
      document.getElementById('share-personas').innerHTML = '';
      alert('🧹 Compartido eliminado');
    });

    // Guardar -> sincroniza (altas/bajas) con upsert
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const comidaId = document.getElementById('share-id').value;
      const grupoId  = document.getElementById('share-grupo').value || null;

      // selección actual
      const seleccionados = Array.from(
        document.querySelectorAll('#share-personas input[name="share-miembro"]:checked')
      ).map(ch => ch.value);

      // estado actual
      const { data: actuales, error: errAct } = await supabase
        .from('comidas_compartidas')
        .select('miembro_id')
        .eq('comida_id', comidaId);

      if (errAct) {
        alert('❌ Error leyendo compartidos');
        return;
      }

      const setActual = new Set((actuales || []).map(r => r.miembro_id));
      const setNuevo  = new Set(seleccionados);

      // Altas
      const aInsertar = [...setNuevo]
        .filter(id => !setActual.has(id))
        .map(id => ({ comida_id: comidaId, grupo_id: grupoId, miembro_id: id }));

      // Bajas
      const aBorrar = [...setActual].filter(id => !setNuevo.has(id));

      if (aInsertar.length) {
        const { error } = await supabase
          .from('comidas_compartidas')
          .upsert(aInsertar, { onConflict: 'comida_id,miembro_id' });
        if (error) {
          console.error(error);
          alert('❌ Error insertando compartidos');
          return;
        }
      }

      if (aBorrar.length) {
        const { error } = await supabase
          .from('comidas_compartidas')
          .delete()
          .eq('comida_id', comidaId)
          .in('miembro_id', aBorrar);
        if (error) {
          console.error(error);
          alert('❌ Error eliminando compartidos');
          return;
        }
      }

      alert('✅ Compartido actualizado');
      document.getElementById('modal-compartir').classList.add('oculto');
    });
  }
  initShareModalHandlers();
  // =============================================================

async function cargarComidaDelDia() {
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

  // 👉 Logs de depuración
  console.log('uid activo:', usuarioId);


    // ----- UI: header de tipo -----
    contenedor.innerHTML = '';
    const slider = document.createElement('div');
    slider.classList.add('comida-tipo-header');
    slider.innerHTML = `
      <button class="flecha-roja" id="comida-prev">⬅</button>
      <span class="titulo-comida">🍽️ ${tipoActual} del día</span>
      <button class="flecha-roja" id="comida-next">➡</button>
    `;
    contenedor.appendChild(slider);
    document.getElementById('comida-prev').onclick = () => cambiarTipo(-1);
    document.getElementById('comida-next').onclick = () => cambiarTipo(1);

    // ----- 1) Comidas propias -----
    const own = await supabase
      .from('comidas_dia')
      .select(`
        id, is_completed, tipo, receta_id, personas,
        recetas (
          nombre,
          ingredientes_receta ( cantidad, unidad, ingrediente_id )
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
console.log('miembroIds:', miembroIds);

if (miembroIds.length) {
  const comp = await supabase
    .from('comidas_compartidas')
    .select('comida_id')
    .in('miembro_id', miembroIds);

  const comidaIds = [...new Set((comp.data || []).map(r => r.comida_id))];
  console.log('comidaIds compartidas:', comidaIds);

  if (comidaIds.length) {
    shared = await supabase
      .from('comidas_dia')
      .select(`
        id, is_completed, tipo, receta_id, personas,
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

    if (own.error)   console.error('Error comidas propias:', own.error.message);
    if (shared.error) console.error('Error comidas compartidas:', shared.error.message);

    // Unir resultados (evitar duplicados por id)
    const mapa = new Map();
    (own.data || []).forEach(r => mapa.set(r.id, r));
    (shared.data || []).forEach(r => mapa.set(r.id, r));
    const data = Array.from(mapa.values());

    if (!data.length) {
      contenedor.innerHTML += `<p>No hay ${tipoActual.toLowerCase()} planeado para hoy.</p>`;
      return;
    }

    // ===== Pintar tarjetas =====
    for (const comida of data) {
      const multiplicador = Math.max(1, Number(comida.personas) || 1);
      const receta = comida.recetas;

      // Cargar info base de ingredientes
      const idsIngredientes = (receta?.ingredientes_receta || []).map(ing => ing.ingrediente_id);
      const ingredientesMap = new Map();
      if (idsIngredientes.length > 0) {
        let { data: ingData } = await supabase
  .from('ingredientes_base')
  .select('id, description, precio, cantidad, calorias, proteinas, unidad')
  .in('id', idsIngredientes)
  .eq('usuario', usuarioId);
if (!ingData || ingData.length === 0) {

          const alt = await supabase
            .from('ingredientes_base')
            .select('id, description, precio, cantidad, calorias, proteinas, unidad')
            .in('id', idsIngredientes);
          ingData = alt.data || [];
        }
        (ingData || []).forEach(ing => ingredientesMap.set(ing.id, ing));
      }

      const card = document.createElement('div');
      card.classList.add('comida-card');

      const encabezado = document.createElement('div');
      encabezado.classList.add('comida-header');

      const nombre = document.createElement('h4');
      nombre.textContent = receta?.nombre || 'Receta';

      // ----- Box personas + compartir -----
      const personasBox = document.createElement('div');
      personasBox.style.display = 'flex';
      personasBox.style.alignItems = 'center';
      personasBox.style.gap = '6px';

      const personasLbl = document.createElement('span');
      personasLbl.textContent = '👥';

      const personasInput = document.createElement('input');
      personasInput.type = 'number';
      personasInput.min = '1';
      personasInput.max = '12';
      personasInput.value = String(multiplicador);
      personasInput.classList.add('personas-input');
      personasInput.style.width = '58px';
      personasInput.onchange = async () => {
        const val = Math.max(1, parseInt(personasInput.value) || 1);
        await supabase.from('comidas_dia').update({ personas: val }).eq('id', comida.id);
        cargarComidaDelDia();
      };

      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'icon-button share btn-share';
      shareBtn.title = 'Compartir';
      shareBtn.dataset.id = comida.id;
      shareBtn.innerHTML = '<i class="fas fa-share-nodes"></i>';

      // Abrir modal + cargar grupos/miembros (con preselección)
      shareBtn.addEventListener('click', async () => {
        const modal = document.getElementById('modal-compartir');
        if (!modal) return;

        // set hidden id
        document.getElementById('share-id').value = comida.id;

        const grupoSelect = document.getElementById('share-grupo');
        const personasDiv = document.getElementById('share-personas');
        grupoSelect.innerHTML = '<option value="">— Ninguno —</option>';
        personasDiv.innerHTML = '';

        // traer lo ya compartido
        const { data: compartidos } = await supabase
          .from('comidas_compartidas')
          .select('grupo_id, miembro_id')
          .eq('comida_id', comida.id);

        const preSelMiembros = new Set((compartidos || []).map(r => r.miembro_id));
        const preSelGrupo = compartidos?.[0]?.grupo_id || '';

        // cargar grupos
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

        // al cambiar grupo -> cargar miembros (email/username visibles)
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
        }

        modal.classList.remove('oculto');
      });

      personasBox.append(personasLbl, personasInput, shareBtn);

      // ----- Toggle Completado -----
      const toggle = document.createElement('button');
      toggle.classList.add('check-small');
      toggle.innerHTML = comida.is_completed ? '✅' : '⭕';
      toggle.onclick = async () => {
        const nuevoEstado = !comida.is_completed;

        // Al completar, descontar de despensa × personas
        if (nuevoEstado && receta?.ingredientes_receta?.length) {
          for (const ing of receta.ingredientes_receta) {
            const ingBase = ingredientesMap.get(ing.ingrediente_id);
            if (!ingBase) continue;

            const nombreIng = ingBase.description;
            const cantidadUsada = (parseFloat(ing.cantidad) || 0) * multiplicador;

            const usuarioActivo = getUsuarioActivo();
            const { data: despensaItem } = await supabase
              .from('despensa')
              .select('id, cantidad')
              .eq('nombre', nombreIng)
              .eq('unidad', ingBase.unidad)
              .eq('usuario', usuarioActivo)
              .maybeSingle();

            if (despensaItem) {
              const cantidadActual = parseFloat(despensaItem.cantidad) || 0;
              const nuevaCantidad = Math.max(cantidadActual - cantidadUsada, 0);
              await supabase
                .from('despensa')
                .update({ cantidad: nuevaCantidad })
                .eq('id', despensaItem.id)
                .eq('usuario', usuarioActivo);
            }
          }
        }

        await supabase
          .from('comidas_dia')
          .update({ is_completed: nuevoEstado })
          .eq('id', comida.id);

        // avisa al resto de la app
        window.dispatchEvent(new CustomEvent('despensa-cambiada'));

        cargarComidaDelDia();
      };

      encabezado.appendChild(nombre);
      encabezado.appendChild(personasBox);
      encabezado.appendChild(toggle);

      // ----- Totales -----
      const baseTot = calcularTotalesReceta
        ? calcularTotalesReceta(receta.ingredientes_receta, Array.from(ingredientesMap.values()))
        : { totalCalorias: 0, totalProteinas: 0, totalPrecio: 0 };

      const kcal   = (baseTot.totalCalorias  || 0) * multiplicador;
      const prot   = (baseTot.totalProteinas || 0) * multiplicador;
      const precio = (baseTot.totalPrecio    || 0) * multiplicador;

      const detalles = document.createElement('p');
      detalles.innerHTML = `
        <strong>Precio:</strong> ${precio.toFixed(2)} € |
        <strong>Calorías:</strong> ${Math.round(kcal)} kcal |
        <strong>Proteínas:</strong> ${Math.round(prot)} g
      `;

      // ----- Ingredientes (toggle) -----
      const lista = document.createElement('ul');
      lista.classList.add('ingredientes-lista');
      (receta?.ingredientes_receta || []).forEach(ing => {
        const ingBase = ingredientesMap.get(ing.ingrediente_id);
        if (!ingBase) return;
        const cant = (parseFloat(ing.cantidad) || 0) * multiplicador;
        const li = document.createElement('li');
        li.textContent = `${ingBase.description}: ${cant} ${ing.unidad}`;
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

      // Montar card
      const cardTop = document.createElement('div');
      cardTop.append(encabezado, detalles, toggleIngredientes, lista);
      card.append(cardTop);
      contenedor.appendChild(card);
    }
  }

  cargarComidaDelDia();
});
