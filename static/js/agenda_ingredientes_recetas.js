// Importa la instancia de Supabase desde supabaseClient.js
import { supabase } from './supabaseClient.js';
import { calcularTotalesReceta } from '../utils/calculos_ingredientes.js';
import { getUsuarioActivo } from './usuario.js';

// Espera a que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', async () => {
  const usuarioActivo = getUsuarioActivo();

  // Estado
  let ingredientes = []; // ingredientes_base
  let recetas = [];

  // DOM
  const listaIngredientes = document.getElementById('lista-ingredientes');
  const listaRecetas = document.getElementById('lista-recetas');
  const porPagina = 10;
  let paginaActual = 1;

  // Modal edición receta
  const modal = document.getElementById('modal-editar-receta');
  const formEditar = document.getElementById('form-editar-receta');
  const inputId = document.getElementById('edit-receta-id');
  const inputNombre = document.getElementById('edit-receta-nombre');
  const inputInstrucciones = document.getElementById('edit-receta-instrucciones');
  const listaIngredientesReceta = document.getElementById('ingredientes-receta-lista');
  const selectNuevoIngrediente = document.getElementById('nuevo-ingrediente-id');
  const inputCantidadNuevo = document.getElementById('nuevo-ingrediente-cantidad');
  const selectUnidadNuevo = document.getElementById('nuevo-ingrediente-unidad');
  const btnAgregarIngrediente = document.getElementById('btn-agregar-ingrediente');
  const btnCancelar = document.getElementById('cancelar-editar-receta');
  const btnPrevIngredientes = document.getElementById('prev-ingredientes');
  const btnNextIngredientes = document.getElementById('next-ingredientes');

  // Totales receta (modal)
  const totalPrecioSpan = document.getElementById('total-precio');
  const totalCaloriasSpan = document.getElementById('total-calorias');
  const totalProteinasSpan = document.getElementById('total-proteinas');

  // Modal edición ingrediente
  const modalEditarIngrediente = document.getElementById('modal-editar-ingrediente');
  const formEditarIngrediente = document.getElementById('form-editar-ingrediente');
  const inputIngId = document.getElementById('edit-ingrediente-id');
  const inputIngNombre = document.getElementById('edit-ingrediente-nombre');
  const inputIngCantidad = document.getElementById('edit-ingrediente-cantidad');
  const inputIngUnidad = document.getElementById('edit-ingrediente-unidad');
  const inputIngCalorias = document.getElementById('edit-ingrediente-calorias');
  const inputIngProteinas = document.getElementById('edit-ingrediente-proteinas');
  const inputIngPrecio = document.getElementById('edit-ingrediente-precio');

  // Buscadores
  const buscadorIngredientes = document.getElementById('buscador-ingredientes');
  const buscadorRecetas = document.getElementById('buscador-recetas');

  // --- Helpers de búsqueda ---
function normalizar(s = '') {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function debounce(fn, wait = 250) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// Filtrar ingredientes
const filtrarIngredientes = (texto) => {
  const q = normalizar(texto);
  const lista = !q ? ingredientes : ingredientes.filter(ing =>
    normalizar(ing.description).includes(q) ||
    normalizar(ing.supermercado || '').includes(q)
  );
  paginaActual = 1;
  mostrarIngredientes(lista);
};

// Filtrar recetas
const filtrarRecetas = (texto) => {
  const q = normalizar(texto);
  const lista = !q ? recetas : recetas.filter(rec =>
    normalizar(rec.nombre || '').includes(q) ||
    normalizar(rec.instrucciones || '').includes(q)
  );
  mostrarRecetas(lista);
};

// Listeners (con debounce para no recalcular en cada tecla)
buscadorIngredientes?.addEventListener('input', debounce(e => filtrarIngredientes(e.target.value)));
buscadorRecetas?.addEventListener('input', debounce(e => filtrarRecetas(e.target.value)));


  // Receta actual en edición
  let recetaActual = null;
  let ingredientesReceta = [];

  // ========= CONFIRMACIONES ROBUSTAS =========
  // Si hay modal #customModal lo usa; si no, usa window.confirm y sigue
  function confirmar(mensaje) {
    const customModal = document.getElementById('customModal');
    if (!customModal) {
      return Promise.resolve(window.confirm(mensaje));
    }
    return new Promise((resolve) => {
      const msg = document.getElementById('customModalMessage');
      const okBtn = document.getElementById('customModalConfirmBtn');
      const cancelBtn = document.getElementById('customModalCancelBtn');

      // Configura UI del modal
      if (msg) msg.textContent = mensaje;
      okBtn?.classList.remove('hidden');
      cancelBtn?.classList.remove('hidden');
      customModal.classList.remove('hidden');

      const cleanup = () => {
        okBtn?.removeEventListener('click', onOk);
        cancelBtn?.removeEventListener('click', onCancel);
        customModal.classList.add('hidden');
      };
      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };

      okBtn?.addEventListener('click', onOk);
      cancelBtn?.addEventListener('click', onCancel);

      // Cerrar si clicas fuera
      customModal.addEventListener('click', function outside(e){
        if (e.target === customModal) { 
          customModal.removeEventListener('click', outside);
          cleanup(); resolve(false); 
        }
      });
    });
  }

  // ========= CARGA Y RENDER =========
  async function cargarIngredientes() {
    const { data, error } = await supabase
      .from('ingredientes_base')
      .select('*')
      .eq('usuario', usuarioActivo); // filtra por usuario activo

    if (error) {
      console.error('Error cargando ingredientes_base:', error);
      return;
    }

    ingredientes = (data || []).map(ing => ({
      id: ing.id,
      description: ing.nombre || ing.description,
      calorias: ing.calorias,
      proteinas: ing.proteinas,
      precio: ing.precio,
      unidad: ing.unidad,
      cantidad: ing.cantidad,
      supermercado: ing.supermercado
    }));

    mostrarIngredientes();
  }

function mostrarIngredientes(lista = ingredientes) {
  if (!listaIngredientes) return;
  listaIngredientes.innerHTML = '';

  const inicio = (paginaActual - 1) * porPagina;
  const fin = inicio + porPagina;
  const paginados = lista.slice(inicio, fin);

  paginados.forEach(ing => {
    const div = document.createElement('div');
    div.className = 'bg-white p-3 rounded-xl shadow-md w-full';
    div.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <strong class="text-lg font-semibold text-gray-800">${ing.description}</strong>
        <div class="flex gap-2">
          <button class="editar-ingrediente bg-blue-600 text-white hover:bg-blue-700 rounded-full w-8 h-8 flex items-center justify-center" data-id="${ing.id}" title="Editar">
            <i class="fas fa-edit text-sm"></i>
          </button>
          <button class="eliminar-ingrediente bg-red-600 text-white hover:bg-red-700 rounded-full w-8 h-8 flex items-center justify-center" data-id="${ing.id}" title="Eliminar">
            <i class="fas fa-trash-alt text-sm"></i>
          </button>
        </div>
      </div>
      <p class="text-sm text-gray-600">${ing.calorias ?? 'null'} kcal, ${ing.proteinas ?? 'null'} g prot, ${ing.precio ?? 'null'} €</p>
    `;
    listaIngredientes.appendChild(div);
  });

  const total = lista.length;
  if (btnPrevIngredientes) btnPrevIngredientes.disabled = paginaActual === 1;
  if (btnNextIngredientes) btnNextIngredientes.disabled = (inicio + porPagina) >= total;
}


  async function cargarRecetas() {
    const { data, error } = await supabase
      .from('recetas')
      .select('*')
      .eq('usuario', usuarioActivo);

    if (error) {
      console.error('Error cargando recetas:', error);
      return;
    }
    recetas = data || [];
    await mostrarRecetas();
  }

  async function mostrarRecetas(lista = recetas) {
  if (!listaRecetas) return;
  listaRecetas.innerHTML = '';

  for (const rec of lista) {
    const { data: ingReceta, error: ingErr } = await supabase
      .from('ingredientes_receta')
      .select('*, ingrediente:ingrediente_id (id, description)')
      .eq('receta_id', rec.id);

    if (ingErr) {
      console.error(`Error cargando ingredientes receta ${rec.id}:`, ingErr);
      continue;
    }

    const { totalPrecio, totalCalorias, totalProteinas } =
      calcularTotalesReceta(ingReceta, ingredientes);

    const ingredientesHTML = (ingReceta ?? []).map(ing => {
      const cantidad = ing.cantidad ?? '?';
      const unidad = ing.unidad ?? '';
      const nombre = ing.ingrediente?.description ?? 'Sin nombre';
      return `<li class="text-sm text-gray-700">${nombre}: ${cantidad} ${unidad}</li>`;
    }).join('');

    const div = document.createElement('div');
    div.className = 'bg-white p-4 rounded-xl shadow-md';
    div.innerHTML = `
      <div class="flex items-start justify-between mb-1">
        <strong class="text-lg font-semibold text-gray-800">${rec.nombre}</strong>
        <div class="flex flex-col items-end gap-2">
          <div class="flex gap-2">
            <button class="editar-receta bg-blue-600 text-white hover:bg-blue-700 rounded-full w-8 h-8 flex items-center justify-center" data-id="${rec.id}" title="Editar">
              <i class="fas fa-edit text-sm"></i>
            </button>
            <button class="eliminar-receta bg-red-600 text-white hover:bg-red-700 rounded-full w-8 h-8 flex items-center justify-center" data-id="${rec.id}" title="Eliminar">
              <i class="fas fa-trash-alt text-sm"></i>
            </button>
          </div>
          <div class="flex items-center gap-1 text-yellow-400 text-xl estrellas" data-id="${rec.id}">
            ${[1,2,3].map(n => `
              <i class="fas fa-star ${rec.puntuacion >= n ? 'text-yellow-400' : 'text-gray-300'} estrella" data-id="${rec.id}" data-valor="${n}" style="cursor:pointer"></i>
            `).join('')}
          </div>
        </div>
      </div>
      <p class="text-sm text-gray-600 mb-2">💰 ${totalPrecio.toFixed(2)} € — 🔥 ${Math.round(totalCalorias)} kcal — 🥚 ${Math.round(totalProteinas)} g</p>
      <details>
        <summary class="cursor-pointer text-gray-700 italic text-sm">Ver ingredientes e instrucciones</summary>
        <div class="mt-2 text-sm text-gray-700">
          <p><strong>Instrucciones:</strong> ${rec.instrucciones || 'Sin instrucciones.'}</p>
          <h5 class="text-md font-semibold mt-2 mb-1">Ingredientes:</h5>
          <ul class="list-disc list-inside space-y-0.5">${ingredientesHTML || '<li>No hay ingredientes definidos.</li>'}</ul>
        </div>
      </details>
    `;
    listaRecetas.appendChild(div);
  }
}


  // ========= MODAL RECETA =========
  function mostrarIngredientesEnFormulario() {
    if (!listaIngredientesReceta) return;
    listaIngredientesReceta.innerHTML = '';

    const unidadesComunes = ['g', 'ml', 'ud', 'kg', 'l', 'cucharada', 'pellizco'];

    ingredientesReceta.forEach((ing, i) => {
      const div = document.createElement('div');
      div.className = 'flex items-center gap-2 p-2 bg-gray-50 rounded-md';
      div.innerHTML = `
        <input type="text" value="${ing.ingrediente?.description || 'Sin nombre'}" disabled
               class="flex-1 border p-2 rounded bg-gray-100 text-gray-700" />
        <input type="number" step="0.1" value="${ing.cantidad ?? ''}" data-index="${i}"
               class="cantidad-edit w-24 border p-2 rounded text-gray-800" />
        <select data-index="${i}" class="unidad-edit w-28 border p-2 rounded text-gray-800">
          ${unidadesComunes.map(u => `<option value="${u}" ${ing.unidad === u ? 'selected' : ''}>${u}</option>`).join('')}
          ${!unidadesComunes.includes(ing.unidad) && ing.unidad ? `<option value="${ing.unidad}" selected>${ing.unidad}</option>` : ''}
        </select>
        <button type="button" data-index="${i}" class="eliminar-ing text-red-600 hover:text-red-800">Eliminar</button>
      `;
      listaIngredientesReceta.appendChild(div);
    });
    actualizarTotalesReceta();
  }

  async function cargarOpcionesIngredientes() {
    if (!selectNuevoIngrediente) return;
    selectNuevoIngrediente.innerHTML = '';
    ingredientes.forEach(ing => {
      const option = document.createElement('option');
      option.value = ing.id;
      option.textContent = ing.description;
      selectNuevoIngrediente.appendChild(option);
    });
  }

  // ========= Paginación =========
  btnPrevIngredientes?.addEventListener('click', () => {
    if (paginaActual > 1) { paginaActual--; mostrarIngredientes(); }
  });
  btnNextIngredientes?.addEventListener('click', () => {
    const totalPaginas = Math.ceil(ingredientes.length / porPagina);
    if (paginaActual < totalPaginas) { paginaActual++; mostrarIngredientes(); }
  });

  // ========= Delegación de eventos (editar/eliminar) =========
  document.addEventListener('click', async (e) => {
    // Editar Receta
    const editRecetaBtn = e.target.closest('.editar-receta');
    if (editRecetaBtn) {
      const id = editRecetaBtn.dataset.id;

      const { data: receta, error: recetaError } = await supabase.from('recetas').select('*').eq('id', id).single();
      const { data: ingReceta, error: ingRecetaError } = await supabase
        .from('ingredientes_receta')
        .select('*, ingrediente:ingrediente_id (id, description)')
        .eq('receta_id', id);

      if (recetaError || ingRecetaError) {
        console.error('Error cargando receta/ingredientes para edición:', recetaError || ingRecetaError);
        alert('Error al cargar la receta para edición.');
        return;
      }

      recetaActual = receta;
      inputId && (inputId.value = receta.id);
      inputNombre && (inputNombre.value = receta.nombre);
      inputInstrucciones && (inputInstrucciones.value = receta.instrucciones || '');
      ingredientesReceta = ingReceta || [];

      await cargarOpcionesIngredientes();
      mostrarIngredientesEnFormulario();
      modal?.classList.remove('hidden');
    }

    // Eliminar Receta
    const deleteRecetaBtn = e.target.closest('.eliminar-receta');
    if (deleteRecetaBtn) {
      const id = deleteRecetaBtn.dataset.id;
      const ok = await confirmar('¿Estás seguro de que quieres eliminar esta receta?');
      if (!ok) return;

      const { error } = await supabase.from('recetas').delete().eq('id', id);
      if (error) {
        console.error('Error eliminando receta:', error);
        alert('Error al eliminar la receta.');
      } else {
        await cargarRecetas();
      }
    }

    // Editar Ingrediente
    const editIngredienteBtn = e.target.closest('.editar-ingrediente');
    if (editIngredienteBtn) {
      const id = editIngredienteBtn.dataset.id;
      const ingrediente = ingredientes.find(i => i.id == id);
      if (!ingrediente) return;

      inputIngId && (inputIngId.value = ingrediente.id);
      inputIngNombre && (inputIngNombre.value = ingrediente.description || '');
      inputIngCantidad && (inputIngCantidad.value = ingrediente.cantidad ?? '');
      inputIngUnidad && (inputIngUnidad.value = ingrediente.unidad ?? '');
      inputIngCalorias && (inputIngCalorias.value = ingrediente.calorias ?? '');
      inputIngProteinas && (inputIngProteinas.value = ingrediente.proteinas ?? '');
      inputIngPrecio && (inputIngPrecio.value = ingrediente.precio ?? '');

      modalEditarIngrediente?.classList.remove('hidden');
    }

    // Eliminar Ingrediente
    const deleteIngredienteBtn = e.target.closest('.eliminar-ingrediente');
    if (deleteIngredienteBtn) {
      const id = deleteIngredienteBtn.dataset.id;
      const ok = await confirmar('¿Estás seguro de que quieres eliminar este ingrediente?');
      if (!ok) return;

      const { error } = await supabase.from('ingredientes_base').delete().eq('id', id);
      if (error) {
        console.error('Error eliminando ingrediente:', error);
        alert('Error al eliminar el ingrediente.');
      } else {
        await cargarIngredientes();
      }
    }
  });

  // Cancelar modales
  btnCancelar?.addEventListener('click', () => modal?.classList.add('hidden'));
  document.getElementById('cancelar-editar-ingrediente')?.addEventListener('click', () => {
    modalEditarIngrediente?.classList.add('hidden');
  });

  // Guardar ingrediente
  if (formEditarIngrediente) {
    formEditarIngrediente.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = inputIngId.value;

      const { error } = await supabase
        .from('ingredientes_base')
        .update({
          nombre: inputIngNombre.value,
          cantidad: parseFloat(inputIngCantidad.value),
          unidad: inputIngUnidad.value,
          calorias: parseFloat(inputIngCalorias.value),
          proteinas: parseFloat(inputIngProteinas.value),
          precio: parseFloat(inputIngPrecio.value),
          usuario: usuarioActivo
        })
        .eq('id', id);

      if (error) {
        console.error('Error al actualizar el ingrediente', error);
        alert('Error al actualizar el ingrediente.');
      } else {
        modalEditarIngrediente?.classList.add('hidden');
        await cargarIngredientes();
      }
    });
  }

  // Añadir ingrediente a una receta (en modal)
  btnAgregarIngrediente?.addEventListener('click', () => {
    const id = selectNuevoIngrediente.value;
    const desc = selectNuevoIngrediente.options[selectNuevoIngrediente.selectedIndex]?.text || '';
    const cantidad = parseFloat(inputCantidadNuevo.value);
    const unidad = selectUnidadNuevo.value;

    if (!id || isNaN(cantidad) || !unidad) {
      alert('Selecciona ingrediente, cantidad y unidad válidos.');
      return;
    }

    ingredientesReceta.push({
      ingrediente_id: id, cantidad, unidad,
      ingrediente: { description: desc }, nuevo: true
    });

    mostrarIngredientesEnFormulario();
    if (inputCantidadNuevo) inputCantidadNuevo.value = '';
    if (selectNuevoIngrediente) selectNuevoIngrediente.value = '';
    if (selectUnidadNuevo) selectUnidadNuevo.value = 'g';
  });

  // Cambios dentro de la lista del modal
  listaIngredientesReceta?.addEventListener('input', (e) => {
    const index = e.target.dataset.index;
    if (e.target.classList.contains('cantidad-edit')) {
      ingredientesReceta[index].cantidad = parseFloat(e.target.value);
    } else if (e.target.classList.contains('unidad-edit')) {
      ingredientesReceta[index].unidad = e.target.value;
    }
    actualizarTotalesReceta();
  });
  listaIngredientesReceta?.addEventListener('click', (e) => {
    if (e.target.classList.contains('eliminar-ing')) {
      const index = e.target.dataset.index;
      ingredientesReceta.splice(index, 1);
      mostrarIngredientesEnFormulario();
    }
  });

  // Guardar receta (modal)
  formEditar?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = inputId.value;
    const nombre = inputNombre.value;
    const instrucciones = inputInstrucciones.value;

    // Borra ingredientes existentes
    const { error: delErr } = await supabase.from('ingredientes_receta').delete().eq('receta_id', id);
    if (delErr) {
      console.error('Error al eliminar ingredientes de la receta:', delErr);
      alert('Error al eliminar ingredientes de la receta.');
      return;
    }

    // Inserta ingredientes actuales
    for (const ing of ingredientesReceta) {
      const { error: insErr } = await supabase.from('ingredientes_receta').insert({
        receta_id: id, ingrediente_id: ing.ingrediente_id,
        cantidad: ing.cantidad, unidad: ing.unidad, usuario: usuarioActivo
      });
      if (insErr) console.error('Error insertando ingrediente:', insErr);
    }

    // Recalcula totales y actualiza receta
    const { totalPrecio, totalCalorias, totalProteinas } =
      calcularTotalesReceta(ingredientesReceta, ingredientes);

    const { error: updErr } = await supabase.from('recetas').update({
      nombre, instrucciones,
      total_precio: totalPrecio,
      total_calorias: totalCalorias,
      total_proteinas: totalProteinas,
      usuario: usuarioActivo
    }).eq('id', id);

    if (updErr) {
      console.error('Error al actualizar la receta:', updErr);
      alert('Error al actualizar la receta.');
      return;
    }

    modal?.classList.add('hidden');
    await cargarRecetas();
  });

  // ========= Inicialización =========
  await cargarIngredientes();
  await cargarRecetas();

  function actualizarTotalesReceta() {
    if (!Array.isArray(ingredientes) || ingredientes.length === 0) return;
    const { totalPrecio, totalCalorias, totalProteinas } =
      calcularTotalesReceta(ingredientesReceta, ingredientes);

    if (totalPrecioSpan) totalPrecioSpan.textContent = `${totalPrecio.toFixed(2)} €`;
    if (totalCaloriasSpan) totalCaloriasSpan.textContent = `${Math.round(totalCalorias)} kcal`;
    if (totalProteinasSpan) totalProteinasSpan.textContent = `${Math.round(totalProteinas)} g`;
  }

  // Puntuación ⭐
  document.addEventListener('click', async (e) => {
    const estrella = e.target.closest('.estrella');
    if (!estrella) return;

    const recetaId = estrella.dataset.id;
    const valor = parseInt(estrella.dataset.valor);

    const { error } = await supabase.from('recetas').update({ puntuacion: valor }).eq('id', recetaId);
    if (error) {
      console.error('Error actualizando puntuación:', error);
      alert('Error al guardar la puntuación.');
    } else {
      const estrellas = document.querySelectorAll(`.estrellas[data-id="${recetaId}"] .estrella`);
      estrellas.forEach((el) => {
        const v = parseInt(el.dataset.valor);
        el.classList.remove('text-yellow-400', 'text-gray-300');
        el.classList.add(v <= valor ? 'text-yellow-400' : 'text-gray-300');
      });
    }
  });
});
