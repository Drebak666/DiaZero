import { supabase } from './supabaseClient.js';
import { getUsuarioActivo } from './usuario.js';


async function cargarIngredientesPendientes() {
  const contenedor = document.getElementById('contenedor-ingredientes-pendientes');
  contenedor.innerHTML = 'Cargando...';

const usuario = getUsuarioActivo();
const { data: despensa, error: errorDespensa } = await supabase
  .from('despensa')
  .select('*')
  .eq('usuario', usuario);


  if (errorDespensa) {
    contenedor.innerHTML = 'Error al cargar la despensa.';
    return;
  }

  // 2. Obtener ingredientes ya registrados
 const { data: ingredientes, error: errorIngredientes } = await supabase
  .from('ingredientes')
  .select('description')
  .eq('usuario', usuario);


  if (errorIngredientes) {
    contenedor.innerHTML = 'Error al cargar ingredientes.';
    return;
  }

  // 3. Filtrar: mostrar solo los que aún no están en la tabla ingredientes
  const yaConvertidos = new Set(ingredientes.map(i => i.description));
  const pendientes = despensa.filter(d => !yaConvertidos.has(d.nombre));

  // 4. Mostrar
  if (pendientes.length === 0) {
    contenedor.innerHTML = '<p>No hay ingredientes pendientes.</p>';
    return;
  }

  contenedor.innerHTML = '';

  pendientes.forEach(item => {
    const div = document.createElement('div');
    div.classList.add('pendiente-card');
    div.innerHTML = `
      <span>${item.nombre}</span>
      <div class="acciones">
        <button class="btn-convertir" data-nombre="${item.nombre}" data-id="${item.id}">Completar</button>
        <button class="btn-borrar" data-id="${item.id}">❌</button>
      </div>
    `;

    contenedor.appendChild(div);
  });

  // Eventos para el botón "Borrar"
  document.querySelectorAll('.btn-borrar').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await supabase.from('despensa').delete().eq('id', id);
      cargarIngredientesPendientes();
    });
  });

  // Eventos para el botón "Completar"
  const formCompletarIngrediente = document.getElementById('form-completar-ingrediente');
  const modalCompletar = document.getElementById('modal-completar');
  const compNombreInput = document.getElementById('comp-nombre');

  document.querySelectorAll('.btn-convertir').forEach(btn => {
    btn.addEventListener('click', (e) => {
      console.log('Botón "Completar" clicado.'); // Registro para depuración
      const nombre = btn.dataset.nombre;
      const id = btn.dataset.id;

      compNombreInput.value = nombre; // Rellenar el nombre del ingrediente
      formCompletarIngrediente.dataset.id = id; // Guardar el ID en el formulario
      modalCompletar.classList.remove('oculto'); // Asegurarse de que la clase 'oculto' se remueve
      modalCompletar.style.display = 'block'; // Forzar la visualización del modal
    });
  });
}

// Ejecutar al cargar la página
window.addEventListener('load', cargarIngredientesPendientes);

// Evento para guardar el nuevo ingrediente
document.getElementById('form-completar-ingrediente').addEventListener('submit', async (e) => {
  e.preventDefault();

  const form = e.target;
  const idDespensa = form.dataset.id;

  // Definir unidadVal antes del objeto
  let unidadVal = document.getElementById('comp-unidad').value.trim();
  if (!unidadVal) unidadVal = 'ud';  // o 'g', elige el que prefieras

  const nuevoIngrediente = {
    description: document.getElementById('comp-nombre').value.trim(),
    supermercado: document.getElementById('comp-supermercado').value.trim() || null,
    precio: parseFloat(document.getElementById('comp-precio').value) || null,
    cantidad: parseFloat(document.getElementById('comp-cantidad').value) || null,
    unidad: unidadVal,
    calorias: parseFloat(document.getElementById('comp-calorias').value) || null,
    proteinas: parseFloat(document.getElementById('comp-proteinas').value) || null
  };

  // ***** INICIO DE LA DEPURACIÓN: AÑADE ESTA LÍNEA AQUÍ *****
  console.log("Valor de nuevoIngrediente.unidad antes de upsert a ingredientes_base:", nuevoIngrediente.unidad);
  // ***** FIN DE LA DEPURACIÓN *****

  const { error: insertError } = await supabase.from('ingredientes').insert([nuevoIngrediente]);

  if (insertError) {
    console.error('❌ Error al guardar el ingrediente en la tabla "ingredientes":', insertError.message);
    return;
  }

  // Guardar también en ingredientes_base
const { error: upsertBaseError } = await supabase
  .from('ingredientes_base')
  .upsert([{
    nombre: nuevoIngrediente.description,
    unidad: nuevoIngrediente.unidad,
    cantidad: nuevoIngrediente.cantidad,
    calorias: nuevoIngrediente.calorias,
    proteinas: nuevoIngrediente.proteinas
  }], {
    onConflict: ['nombre']  // 👈 Esto indica que si ya existe, lo actualice
  });



  // ***** INICIO DE LA DEPURACIÓN Y MANEJO DE ERRORES: AÑADE ESTE BLOQUE AQUÍ *****
  if (upsertBaseError) {
    console.error('❌ Error al guardar en ingredientes_base:', upsertBaseError.message);
    // Puedes decidir si quieres detener la ejecución aquí o continuar.
    // Si la unidad es crítica, deberías hacer 'return;'.
    // Si no es crítica y prefieres que el resto del proceso siga, podrías quitar el 'return'.
    // Para depurar, es mejor mantener el 'return'.
    return;
  }
  // ***** FIN DE LA DEPURACIÓN Y MANEJO DE ERRORES *****

  console.log("Actualizando despensa con:", {
    cantidad: nuevoIngrediente.cantidad,
    unidad: nuevoIngrediente.unidad
  });

  // Buscar el ingrediente en ingredientes_base
  const { data: ingredienteBase, error: baseError } = await supabase
    .from("ingredientes_base")
    .select("id")
    .eq("description", nuevoIngrediente.description)
    .single();

  let cantidadRealComprada = nuevoIngrediente.cantidad;
  let unidadRealComprada = nuevoIngrediente.unidad;

  // Buscar en ingredientes_supermercado si hay cantidad real comprada
  if (ingredienteBase && ingredienteBase.id) {
    const { data: supermercadoData, error: supermercadoError } = await supabase
      .from("ingredientes_supermercado")
      .select("cantidad, unidad")
      .eq("ingrediente_id", ingredienteBase.id)
      .order("fecha_precio", { ascending: false })
      .limit(1)
      .single();

    if (supermercadoData) {
      cantidadRealComprada = supermercadoData.cantidad;
      unidadRealComprada = supermercadoData.unidad;
    }
  }

  await supabase.from('despensa').update({
    cantidad: cantidadRealComprada,
    unidad: unidadRealComprada
  }).eq('id', idDespensa);

  const modalCompletar = document.getElementById('modal-completar');
  modalCompletar.classList.add('oculto');
  modalCompletar.style.display = 'none';
  form.reset();
  cargarIngredientesPendientes();
  if (typeof cargarDespensa === 'function') {
    cargarDespensa();
  }
});


// Evento para cerrar el modal "Completar ingrediente"
document.getElementById('cerrar-completar').addEventListener('click', () => {
  const modalCompletar = document.getElementById('modal-completar');
  modalCompletar.classList.add('oculto');
  modalCompletar.style.display = 'none'; // Forzar ocultamiento
});

async function cargarSupermercadosUnicos() {
  const { data: ingredientes, error } = await supabase
    .from('ingredientes')
    .select('supermercado');

  if (error) {
    console.warn('No se pudo cargar supermercados', error.message);
    return;
  }

  const supermercados = new Set(
    ingredientes.map(i => i.supermercado).filter(s => s && s.trim() !== '')
  );

  const datalist = document.getElementById('supermercados');
  datalist.innerHTML = '';
  supermercados.forEach(nombre => {
    const option = document.createElement('option');
    option.value = nombre;
    datalist.appendChild(option);
  });
}

// Ejecutar ambas funciones al cargar la página
window.addEventListener('load', () => {
  cargarIngredientesPendientes();
  cargarSupermercadosUnicos();
});