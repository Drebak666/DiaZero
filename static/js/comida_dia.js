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

  async function cargarComidaDelDia() {
    const hoy = new Date().toISOString().split('T')[0];
    const usuario = getUsuarioActivo();

    const { data, error } = await supabase
      .from('comidas_dia')
      .select(`
        id, is_completed, tipo, receta_id, personas,
        recetas (
          nombre,
          ingredientes_receta (
            cantidad, unidad, ingrediente_id
          )
        )
      `)
      .eq('fecha', hoy)
      .eq('tipo', tipoActual)
      .eq('usuario', usuario);

    // UI header
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

    if (error) {
      console.error('Error al cargar comida:', error.message);
      contenedor.innerHTML += `<p>Error al cargar datos.</p>`;
      return;
    }
    if (!data || data.length === 0) {
      contenedor.innerHTML += `<p>No hay ${tipoActual.toLowerCase()} planeado para hoy.</p>`;
      return;
    }

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
          .eq('usuario', usuario);

        // Fallback si la tabla no guarda usuario
        if (!ingData || ingData.length === 0) {
          const alt = await supabase
            .from('ingredientes_base')
            .select('id, description, precio, cantidad, calorias, proteinas, unidad')
            .in('id', idsIngredientes);
          ingData = alt.data || [];
        }
        (ingData || []).forEach(ing => ingredientesMap.set(ing.id, ing));
      }

      // Card
      const card = document.createElement('div');
      card.classList.add('comida-card');

      // Encabezado
      const encabezado = document.createElement('div');
      encabezado.classList.add('comida-header');

      const nombre = document.createElement('h4');
      nombre.textContent = receta?.nombre || 'Receta';

      // Selector de personas
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
      personasBox.append(personasLbl, personasInput);

      // Toggle completado
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

      // Totales escalados
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

      // Lista de ingredientes (cantidades × personas)
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

      // Botón ver/ocultar
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
      card.append(encabezado, detalles, toggleIngredientes, lista);
      contenedor.appendChild(card);
    }
  }

  cargarComidaDelDia();
});
