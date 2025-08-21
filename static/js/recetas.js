import { supabase } from './supabaseClient.js';
import { calcularTotalesReceta } from '../utils/calculos_ingredientes.js';
import { getUsuarioActivo } from './usuario.js';



function showMessageModal(mensaje) {
    const modal = document.getElementById('message-modal');
    const texto = document.getElementById('message-text');
    const btnOk = document.getElementById('modal-ok-button');
    const btnClose = document.querySelector('.close-button');
    if (!modal || !texto || !btnOk || !btnClose) {
        // Fallback to alert if modal elements are not found
        // In a real application, you'd want a more robust fallback or ensure modal exists
        alert(mensaje); 
        return;
    }
    texto.textContent = mensaje;
    modal.classList.remove('oculto');
    function cerrar() {
        modal.classList.add('oculto');
        btnOk.removeEventListener('click', cerrar);
        btnClose.removeEventListener('click', cerrar);
    }
    btnOk.addEventListener('click', cerrar);
    btnClose.addEventListener('click', cerrar);
}

let ingredientesRecetaSeleccionados = [];

export async function cargarIngredientesParaReceta() {
    const select = document.getElementById('receta-seleccionar-ingrediente');
    if (!select) return;

    select.innerHTML = '<option value="">Selecciona un ingrediente</option>';

    // CAMBIO AQUÍ: Usar 'ingredientes_base' para consistencia con menu.js
const usuario = getUsuarioActivo();
const { data, error } = await supabase
  .from('ingredientes_base')
  .select('id, description, unidad, calorias, proteinas, precio, cantidad, usuario')
  .eq('usuario', usuario);



    if (error) {
        showMessageModal('Error al cargar ingredientes: ' + error.message);
        return;
    }

    data.forEach(ingrediente => {
        const option = document.createElement('option');
        option.value = ingrediente.id;
        option.textContent = `${ingrediente.description} (${ingrediente.unidad})`;
        option.dataset.nombre = ingrediente.description;
        option.dataset.unidad = ingrediente.unidad;
        option.dataset.calorias = ingrediente.calorias || 0;
        option.dataset.proteinas = ingrediente.proteinas || 0;
        option.dataset.precio = ingrediente.precio || 0;
        option.dataset.cantidadBase = ingrediente.cantidad || 0; // Añadir cantidad base al dataset
        select.appendChild(option);
    });
}

function renderizarIngredientesReceta() {
    const contenedor = document.getElementById('receta-ingredientes-container');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    ingredientesRecetaSeleccionados.forEach((ing, index) => {
        const item = document.createElement('div');
        item.classList.add('requisito-item');
        item.innerHTML = `
            <span>${ing.nombre} (${ing.cantidad} ${ing.unidad})</span>
            <button type="button" data-index="${index}">&times;</button>
        `;
        item.querySelector('button').addEventListener('click', () => {
            ingredientesRecetaSeleccionados.splice(index, 1);
            renderizarIngredientesReceta();
            actualizarTotales();
        });
        contenedor.appendChild(item);
    });
}

function actualizarTotales() {
  const baseIngredientes = ingredientesRecetaSeleccionados.map(ing => ({
    id: ing.id,
    description: ing.nombre,
    unidad: ing.unidad,
    calorias: ing.calorias,
    proteinas: ing.proteinas,
    precio: ing.precio,
    cantidad: ing.cantidadBase || 100 // base de comparación
  }));

  const { totalPrecio, totalCalorias, totalProteinas } =
    calcularTotalesReceta(ingredientesRecetaSeleccionados, baseIngredientes);

  document.getElementById('total-calorias').textContent = totalCalorias.toFixed(2);
  document.getElementById('total-proteinas').textContent = totalProteinas.toFixed(2);
  document.getElementById('total-precio').textContent = totalPrecio.toFixed(2);
}




export async function guardarReceta() {
    const nombre = document.getElementById('nueva-actividad-descripcion')?.value.trim();
    const instrucciones = document.getElementById('receta-instrucciones')?.value.trim();

    if (!nombre || !instrucciones) {
        showMessageModal('Introduce una descripción y las instrucciones.');
        return;
    }

    if (ingredientesRecetaSeleccionados.length === 0) {
        showMessageModal('Agrega al menos un ingrediente.');
        return;
    }

    // Convertimos el array de ingredientes a JSON (esto es para la columna 'ingredientes' en la tabla 'recetas')
    const ingredientesJSON = JSON.stringify(ingredientesRecetaSeleccionados);

    try {
const usuario = getUsuarioActivo();

const { data: receta, error: recetaError } = await supabase
  .from('recetas')
  .insert([{ nombre, instrucciones, ingredientes: ingredientesJSON, usuario }])
  .select()
  .single();


        if (recetaError) throw recetaError;

        // Formatear los ingredientes para la tabla 'ingredientes_receta'
        const ingredientesFormateados = ingredientesRecetaSeleccionados.map(ing => ({
            receta_id: receta.id,
            ingrediente_id: ing.id, // Asegúrate de que este ID sea el de ingredientes_base
            cantidad: ing.cantidad,
            unidad: ing.unidad
        }));

        const { error: ingredientesError } = await supabase
            .from('ingredientes_receta')
            .insert(ingredientesFormateados);

        if (ingredientesError) throw ingredientesError;

        showMessageModal('Receta guardada correctamente.');
        // Opcional: limpiar el formulario después de guardar
        document.getElementById('nueva-actividad-descripcion').value = '';
        document.getElementById('receta-instrucciones').value = '';
        ingredientesRecetaSeleccionados = [];
        renderizarIngredientesReceta();
        actualizarTotales();

    } catch (err) {
        console.error('Error al guardar la receta:', err);
        showMessageModal('Error al guardar la receta.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btnAdd = document.getElementById('btn-añadir-ingrediente-receta');
    const select = document.getElementById('receta-seleccionar-ingrediente');
    const inputCantidad = document.getElementById('receta-cantidad-ingrediente');
    const btnGuardar = document.getElementById('boton-guardar-receta');

    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const option = select.options[select.selectedIndex];
            // Verificar si se ha seleccionado una opción válida
            if (!option || !option.value) {
                showMessageModal('Selecciona un ingrediente válido.');
                return;
            }

            const ingredienteId = option.value;
            const ingredienteNombre = option.dataset.nombre;
            const unidad = option.dataset.unidad;
            const cantidad = parseFloat(inputCantidad.value);
            const calorias = parseFloat(option.dataset.calorias) || 0;
            const proteinas = parseFloat(option.dataset.proteinas) || 0;
            const precio = parseFloat(option.dataset.precio) || 0;
            const cantidadBase = parseFloat(option.dataset.cantidadBase) || 0; // Obtener la cantidad base

            if (isNaN(cantidad) || cantidad <= 0) {
                showMessageModal('Introduce una cantidad válida y mayor que cero.');
                return;
            }

            ingredientesRecetaSeleccionados.push({
                id: ingredienteId,
                nombre: ingredienteNombre,
                cantidad,
                unidad,
                calorias,
                proteinas,
                precio,
                cantidadBase // Guardar la cantidad base para el cálculo posterior
            });

            renderizarIngredientesReceta();
            actualizarTotales();

            select.value = '';
            inputCantidad.value = '';
        });
    }

    if (btnGuardar) {
        btnGuardar.addEventListener('click', guardarReceta);
    }

    // Exportar la función para que sea accesible globalmente si es necesario
    window.cargarIngredientesParaReceta = cargarIngredientesParaReceta;

    // Cargar ingredientes al cargar la página
    cargarIngredientesParaReceta();
});
