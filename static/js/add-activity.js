// static/js/add-activity.js
import { supabase } from './supabaseClient.js';
import { guardarReceta } from './recetas.js'; // si no existe, no pasa nada con los guards

// ---------- util ----------
function mostrarBloqueAlimentacion() {
  document.getElementById('grupo-nombre-descripcion')?.classList.remove('oculto');
  document.getElementById('formularios-actividad')?.classList.remove('oculto');
  document.getElementById('botones-actividad')?.classList.remove('oculto');
}
function normalizeRequirements(reqs) {
  if (!Array.isArray(reqs)) return [];
  return reqs.map(r => {
    if (typeof r === 'string') return { text: r, checked: false };
    const text = (r && typeof r.text === 'string') ? r.text : '';
    const checked = !!(r && r.checked);
    return { text, checked };
  });
}
function normaliza(s=''){ return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

// ---------- estado ----------
let tipoSeleccionado = null;
const requisitosCita = [];
let inputNuevoRequisito, btnAñadirRequisito, contenedorRequisitos;

// id del ingrediente base elegido (para histórico por supermercado)
let selectedBaseId = null;

// ---------- requisitos UI ----------
function renderizarRequisitos() {
  if (!contenedorRequisitos) return;
  contenedorRequisitos.innerHTML = '';
  requisitosCita.forEach((req, index) => {
    const item = document.createElement('div');
    item.classList.add('requirement-item');
    item.innerHTML = `<span>${req.text}</span> <button type="button" data-index="${index}">&times;</button>`;
    item.querySelector('button').addEventListener('click', () => {
      requisitosCita.splice(index, 1);
      renderizarRequisitos();
    });
    contenedorRequisitos.appendChild(item);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('nueva-actividad-formulario');
  const descripcionInput = document.getElementById('nueva-actividad-descripcion');
  const formulariosActividad = document.getElementById('formularios-actividad');
  const cancelarBtn = document.getElementById("cancelar-nueva-actividad");
  const tipoButtons = document.querySelectorAll('.icon-button[data-type]');
  const botonesActividad = document.getElementById("botones-actividad");
  const btnNota = document.getElementById('btn-nota-actividad');

  inputNuevoRequisito = document.getElementById('nuevo-requisito-cita');
  btnAñadirRequisito = document.getElementById('btn-añadir-requisito-cita');
  // === GRUPOS: cargar los del admin y rellenar selects ===
  



async function cargarSelectsGrupos() {
  const username = localStorage.getItem("usuario_actual") || "";
  const seles = document.querySelectorAll(".select-grupo");
  if (!seles.length) return;

  // resolver UUID admin
  const { data: me, error: e1 } = await supabase
    .from("usuarios")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (e1 || !me) {
    seles.forEach(s => s.innerHTML = `<option value="">— Ninguno —</option>`);
    return;
  }

  const { data, error } = await supabase
    .from("grupos")
    .select("id, nombre")
    .eq("admin_id", me.id)
    .order("nombre", { ascending: true });

  const opts = [`<option value="">— Ninguno —</option>`]
    .concat((data || []).map(g => `<option value="${g.id}">${g.nombre}</option>`))
    .join("");

  seles.forEach(s => s.innerHTML = opts);
}

// Rellenar en cuanto se carga la pantalla de “Añadir actividad”
cargarSelectsGrupos();

  contenedorRequisitos = document.getElementById('cita-requisitos-container');

  // --------- Supermercado: badge + histórico ----------
  const supSelect   = document.getElementById('ingrediente-supermercado');
  const precioInput = document.getElementById('ingrediente-precio');

  const SUP_COLORS = {
    'Lidl':      { bg:'#1e293b', fg:'#93c5fd' },
    'Mercadona': { bg:'#1f2937', fg:'#86efac' },
    'Carrefour': { bg:'#111827', fg:'#fda4af' }
  };

  // Badge junto al select
  let supBadge;
  function ensureSupBadge() {
    if (!supSelect) return;
    if (!supBadge) {
      supBadge = document.createElement('span');
      supBadge.className = 'super-badge';
      supBadge.style.marginLeft = '8px';
      supBadge.style.padding = '2px 8px';
      supBadge.style.borderRadius = '999px';
      supBadge.style.fontSize = '12px';
      supBadge.style.border = '1px solid #374151';
      supSelect.parentElement.appendChild(supBadge);
    }
  }
  function renderSupBadge(value) {
    ensureSupBadge();
    if (!supBadge) return;
    const c = SUP_COLORS[value] || { bg:'#0b1220', fg:'#cbd5e1' };
    supBadge.textContent = value || '—';
    supBadge.style.background = c.bg;
    supBadge.style.color = c.fg;
  }
  supSelect?.addEventListener('change', () => renderSupBadge(supSelect.value));
  renderSupBadge(supSelect?.value || '');

  // ---------- RESOLVER ID DEL INGREDIENTE BASE ----------
  async function resolveBaseIdByName(nombre) {
    if (selectedBaseId) return selectedBaseId;
    const { data, error } = await supabase
      .from('ingredientes_base')
      .select('id')
      .ilike('nombre', nombre)
      .limit(1);
    if (!error && data && data.length) {
      selectedBaseId = data[0].id;
    }
    return selectedBaseId;
  }

  // ---------- HISTÓRICO en ingredientes_supermercado ----------
  async function fetchHistoricoByBaseId(baseId, onlyLatest) {
    if (!baseId) return { data: [] };
    const usuario = localStorage.getItem('usuario_actual') || '';

    let q = supabase
      .from('ingredientes_supermercado')
      .select('supermercado, precio, fecha_precio')
      .eq('ingrediente_id', baseId)
      .eq('usuario', usuario)
      .order('fecha_precio', { ascending: false })
      .limit(onlyLatest ? 1 : 200);

    const { data, error } = await q;
    if (error) {
      console.warn('Error cargando histórico:', error.message);
      return { data: [] };
    }
    return { data };
  }

  // ---------- Último precio ----------
  let ultimoHint;
  function ensureUltimoHint() {
    if (!precioInput) return;
    if (!ultimoHint) {
      ultimoHint = document.createElement('div');
      ultimoHint.id = 'ultimo-precio-hint';
      ultimoHint.style.fontSize = '12px';
      ultimoHint.style.color = '#94a3b8';
      ultimoHint.style.marginTop = '6px';
      precioInput.parentElement.appendChild(ultimoHint);
    }
  }
  async function mostrarUltimoPrecio(nombre) {
    ensureUltimoHint();
    if (!ultimoHint || !nombre) { if (ultimoHint) ultimoHint.textContent=''; return; }

    // asegura baseId
    const baseId = await resolveBaseIdByName(nombre);
    if (!baseId) { ultimoHint.textContent = ''; return; }

    const { data } = await fetchHistoricoByBaseId(baseId, true);
    if (!data || !data.length) { ultimoHint.textContent = ''; return; }

    const { supermercado, precio, fecha_precio } = data[0];
    let fechaStr = '';
    if (fecha_precio) {
      const d = new Date(fecha_precio);
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      fechaStr = ` (${dd}-${mm})`;
    }

    ultimoHint.innerHTML =
      `Último: <strong>${supermercado || '—'}</strong> — <strong>${(precio ?? '').toString().replace('.', ',')}</strong>€` +
      `<span style="opacity:.7">${fechaStr}</span> · ` +
      `<a href="#" id="usar-ultimo-precio" style="text-decoration:underline">Usar</a>`;

    document.getElementById('usar-ultimo-precio')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (supermercado && supSelect) { supSelect.value = supermercado; renderSupBadge(supermercado); }
      if (precio != null && precioInput) precioInput.value = precio;
    });
  }

  // ---------- Chips de supermercados (presentes/ausentes) ----------
  let supPresence;
  function ensureSupPresenceZone() {
    if (!supSelect) return;
    if (!supPresence) {
      supPresence = document.createElement('div');
      supPresence.id = 'sup-presence';
      supPresence.style.marginTop = '6px';
      supSelect.parentElement.appendChild(supPresence);
    }
  }
  function renderSupPresence(pricesBySup = new Map()) {
    ensureSupPresenceZone();
    if (!supPresence) return;

    const allOptions = Array.from(supSelect?.options || [])
      .map(o => o.value)
      .filter(Boolean);

    supPresence.innerHTML = `
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">
        Supermercados:
        <span id="sup-chips" style="display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:6px"></span>
      </div>
    `;
    const chips = supPresence.querySelector('#sup-chips');

    allOptions.forEach(sup => {
      const has = pricesBySup.has(sup);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.sup = sup;
      btn.className = 'sup-chip';
      btn.style.borderRadius = '999px';
      btn.style.padding = '2px 8px';
      btn.style.border = '1px solid #374151';
      btn.style.fontSize = '12px';

      if (has) {
        const c = SUP_COLORS[sup] || { bg: '#0b1220', fg: '#cbd5e1' };
        btn.style.background = c.bg;
        btn.style.color = c.fg;
        const price = pricesBySup.get(sup);
        btn.textContent = (price != null && price !== '') ? `${sup} · ${price}€` : sup;
      } else {
        btn.style.background = 'transparent';
        btn.style.color = '#94a3b8';
        btn.style.opacity = '0.7';
        btn.textContent = sup; // o `${sup} +`
      }

      chips.appendChild(btn);
    });

    chips.querySelectorAll('.sup-chip').forEach(b => {
      b.addEventListener('click', (e) => {
        const sup = e.currentTarget.dataset.sup;
        const price = pricesBySup.get(sup);
        if (supSelect) { supSelect.value = sup; renderSupBadge(sup); }
        if (precioInput) {
          if (price != null && price !== '') precioInput.value = price;
          else precioInput.focus();
        }
      });
    });
  }
  async function mostrarSupersGuardados(nombre) {
    ensureSupPresenceZone();
    if (!supPresence || !nombre) { renderSupPresence(new Map()); return; }

    const baseId = await resolveBaseIdByName(nombre);
    if (!baseId) { renderSupPresence(new Map()); return; }

    const { data } = await fetchHistoricoByBaseId(baseId, false);

    // Primer precio por súper (data viene ya ordenada desc por fecha_precio)
    const pricesBySup = new Map();
    if (data && data.length) {
      for (const row of data) {
        const sup = row.supermercado || '';
        if (!sup) continue;
        if (!pricesBySup.has(sup)) pricesBySup.set(sup, row.precio);
      }
    }
    renderSupPresence(pricesBySup);
  }

  // ---------- Autocompletado ingredientes_base ----------
  let baseIngredientes = [];
  let baseCargada = false;
  let autoEl = null;

  function injectAutocompleteStylesOnce() {
    if (document.getElementById('ing-autocomplete-style')) return;
    const style = document.createElement('style');
    style.id = 'ing-autocomplete-style';
    style.textContent = `
      .ing-auto-box{
        position: absolute; z-index: 9999; background:#111827; color:#e5e7eb;
        border:1px solid #374151; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.35);
        max-height:240px; overflow:auto; padding:4px; min-width:280px;
      }
      .ing-auto-item{ padding:8px 10px; border-radius:8px; cursor:pointer; }
      .ing-auto-item:hover{ background:#1f2937; }
      .ing-auto-muted{ color:#9ca3af; font-size:.85em; }
    `;
    document.head.appendChild(style);
  }
  async function cargarBaseIngredientes() {
    if (baseCargada) return;
    const { data, error } = await supabase
      .from('ingredientes_base')
      .select('id,nombre,description,unidad,cantidad,calorias,proteinas,precio,supermercado')
      .order('nombre', { ascending: true });
    if (!error && data) {
      baseIngredientes = data.map(x => ({
        id: x.id,
        nombre: x.nombre || x.description || '',
        unidad: x.unidad || 'g',
        cantidad: x.cantidad ?? null,
        calorias: x.calorias ?? null,
        proteinas: x.proteinas ?? null,
        precio: x.precio ?? null,
        supermercado: x.supermercado || ''
      }));
      baseCargada = true;
    } else {
      console.warn('No se pudo cargar ingredientes_base:', error);
    }
  }
  function ocultarAutocomplete(){ if (autoEl){ autoEl.remove(); autoEl=null; } }
  function mostrarAutocomplete(items, anchorInput) {
    ocultarAutocomplete();
    if (!items || !items.length) return;

    injectAutocompleteStylesOnce();
    autoEl = document.createElement('div');
    autoEl.className = 'ing-auto-box';
    autoEl.innerHTML = items.slice(0, 12).map(it => `
      <div class="ing-auto-item" data-id="${it.id}">
        <div><strong>${it.nombre}</strong></div>
        <div class="ing-auto-muted">${it.cantidad ?? ''} ${it.unidad ?? ''} — ${it.calorias ?? '∅'} kcal — ${it.proteinas ?? '∅'} g</div>
      </div>
    `).join('');
    document.body.appendChild(autoEl);

    const r = anchorInput.getBoundingClientRect();
    autoEl.style.left = `${r.left + window.scrollX}px`;
    autoEl.style.top  = `${r.bottom + 6 + window.scrollY}px`;
    autoEl.style.minWidth = `${Math.max(280, r.width)}px`;

    autoEl.addEventListener('click', (e) => {
      const item = e.target.closest('.ing-auto-item');
      if (!item) return;
      const id = item.dataset.id;
      const ing = baseIngredientes.find(x => String(x.id) === String(id));
      if (ing) aplicarIngredienteBase(ing);
      ocultarAutocomplete();
    });

    setTimeout(() => {
      const onDocClick = (ev) => {
        if (!autoEl || autoEl.contains(ev.target) || ev.target === descripcionInput) return;
        ocultarAutocomplete();
        document.removeEventListener('click', onDocClick);
      };
      document.addEventListener('click', onDocClick);
    }, 0);
  }
  function aplicarIngredienteBase(ing){
    selectedBaseId = ing.id || null; // << guardar id del base

    const unidadEl = document.getElementById('ingrediente-unidad');
    const cantEl   = document.getElementById('ingrediente-cantidad');
    const calEl    = document.getElementById('ingrediente-calorias');
    const protEl   = document.getElementById('ingrediente-proteinas');
    const precEl   = document.getElementById('ingrediente-precio');

    if (descripcionInput) descripcionInput.value = ing.nombre || '';
    if (unidadEl && ing.unidad) unidadEl.value = ing.unidad;
    if (cantEl   && ing.cantidad != null)  cantEl.value = ing.cantidad;
    if (calEl    && ing.calorias != null)  calEl.value = ing.calorias;
    if (protEl   && ing.proteinas != null) protEl.value = ing.proteinas;
    if (precEl   && ing.precio != null)    precEl.value = ing.precio;

    if (supSelect && ing.supermercado) {
      const opt = Array.from(supSelect.options).find(o => o.value === ing.supermercado);
      if (opt) supSelect.value = ing.supermercado;
    }
    renderSupBadge(supSelect?.value || '');

    // histórico por supermercado
    mostrarUltimoPrecio(ing.nombre);
    mostrarSupersGuardados(ing.nombre);
  }
  function onInputDesc_Ing() {
    if (tipoSeleccionado !== 'Ingrediente') { ocultarAutocomplete(); return; }
    const q = normaliza(descripcionInput.value.trim());
    if (!q) { ocultarAutocomplete(); renderSupPresence(new Map()); selectedBaseId=null; return; }

    const res = baseIngredientes
      .filter(i => normaliza(i.nombre).includes(q))
      .sort((a,b) => normaliza(a.nombre).indexOf(q) - normaliza(b.nombre).indexOf(q));

    if (res.length) mostrarAutocomplete(res, descripcionInput);
    else ocultarAutocomplete();
  }
  function activarAutocompleteIngrediente(){
    cargarBaseIngredientes();
    descripcionInput?.addEventListener('input', onInputDesc_Ing);
    descripcionInput?.addEventListener('focus', onInputDesc_Ing);
    descripcionInput?.addEventListener('blur', async () => {
      setTimeout(ocultarAutocomplete, 150);
      const nombre = (descripcionInput?.value || '').trim();
      if (nombre) {
        // intenta resolver id si no lo tenemos (caso: escribió y no clicó)
        if (!selectedBaseId) await resolveBaseIdByName(nombre);
        mostrarUltimoPrecio(nombre);
        mostrarSupersGuardados(nombre);
      }
    });
  }
  function desactivarAutocompleteIngrediente(){
    descripcionInput?.removeEventListener('input', onInputDesc_Ing);
    descripcionInput?.removeEventListener('focus', onInputDesc_Ing);
    ocultarAutocomplete();
    renderSupPresence(new Map());
    selectedBaseId = null;
  }

  // ---------- Notas (opcional) ----------
  async function actualizarContadorNotas() {
    const usuarioActual = localStorage.getItem('usuario_actual') || '';
    const { count, error } = await supabase
      .from('notas')
      .select('*', { count: 'exact', head: true })
      .eq('usuario', usuarioActual);

    const badge = document.getElementById('contador-notas');
    if (!error && badge) {
      badge.style.display = count > 0 ? 'inline-block' : 'none';
      if (count > 0) badge.textContent = count;
    }
  }
  if (btnNota) {
    btnNota.addEventListener('click', async () => {
      const texto = descripcionInput.value.trim();
      const usuario = localStorage.getItem('usuario_actual') || '';
      if (!texto) { window.location.href = '/notas'; return; }
      const { error } = await supabase.from('notas').insert([{ descripcion: texto, usuario }]);
      if (!error) { descripcionInput.value=''; actualizarContadorNotas(); }
    });
    actualizarContadorNotas();
  }

  // ---------- Botones tipo ----------
  tipoButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.type;

      if (btn.id === 'btn-musica-actividad' || tipo === 'Musica') {
        tipoSeleccionado = null;
        mostrarFormulario('Musica');
        return;
      }

      tipoSeleccionado = tipo;
      mostrarFormulario(tipo);
    });
  });

  function setDefaultsForTask() {
    const now = new Date();
    const fechaInput = document.getElementById('tarea-fecha');
    if (fechaInput) fechaInput.value = now.toISOString().split('T')[0];
    const startInput = document.getElementById('tarea-hora-inicio');
    const endInput   = document.getElementById('tarea-hora-fin');
    if (startInput) startInput.value = new Date(now.getTime()+60*60*1000).toTimeString().slice(0,5);
    if (endInput)   endInput.value   = new Date(now.getTime()+2*60*60*1000).toTimeString().slice(0,5);
  }
  function setDefaultsForRoutine() {
    const now = new Date();
    const fechaInput = document.getElementById('rutina-fecha');
    if (fechaInput) fechaInput.value = now.toISOString().split('T')[0];
    const startInput = document.getElementById('rutina-hora-inicio');
    const endInput   = document.getElementById('rutina-hora-fin');
    if (startInput) startInput.value = new Date(now.getTime()+60*60*1000).toTimeString().slice(0,5);
    if (endInput)   endInput.value   = new Date(now.getTime()+2*60*60*1000).toTimeString().slice(0,5);
  }

  function mostrarFormulario(tipo) {
    if (!tipo) return;

    if (tipo === 'Musica') {
      document.getElementById('formularios-actividad')?.classList.remove('oculto');
      document.querySelectorAll('.tipo-formulario').forEach(f => f.classList.add('oculto'));
      document.getElementById('form-musica')?.classList.remove('oculto');
      document.getElementById('grupo-nombre-descripcion')?.classList.add('oculto');
      document.getElementById('botones-actividad')?.classList.add('oculto');
      desactivarAutocompleteIngrediente();
      return;
    }

    mostrarBloqueAlimentacion();
    document.querySelectorAll('.tipo-formulario').forEach(f => f.classList.add('oculto'));
    const formToShow = document.getElementById(`form-${tipo.toLowerCase()}`);
    if (formToShow) {
      formToShow.classList.remove('oculto');
      formToShow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (tipo === 'Ingrediente') activarAutocompleteIngrediente();
    else desactivarAutocompleteIngrediente();

    if (tipo === 'Receta' && typeof cargarIngredientesParaReceta === 'function') {
      cargarIngredientesParaReceta();
    }
    if (tipo === 'Tarea')  setDefaultsForTask();
    if (tipo === 'Rutina') setDefaultsForRoutine();

    setTimeout(() => {
      if (descripcionInput) {
        descripcionInput.focus();
        const len = descripcionInput.value.length;
        descripcionInput.setSelectionRange(len, len);
      }
    }, 50);
  }

  // ---------- requisitos cita ----------
  if (btnAñadirRequisito && inputNuevoRequisito && contenedorRequisitos) {
    btnAñadirRequisito.addEventListener('click', () => {
      const texto = inputNuevoRequisito.value.trim();
      if (!texto) return;
      requisitosCita.push({ text: texto, checked: false });
      renderizarRequisitos();
      inputNuevoRequisito.value = '';
    });
  }

  // ---------- cancelar ----------
  cancelarBtn?.addEventListener("click", () => {
    document.getElementById('grupo-nombre-descripcion')?.classList.add('oculto');
    formulariosActividad?.classList.add("oculto");
    document.querySelectorAll(".tipo-formulario").forEach(form => form.classList.add("oculto"));
    descripcionInput.value = "";
    desactivarAutocompleteIngrediente();
    botonesActividad?.classList.add("oculto");
  });

  // ---------- submit (no Música) ----------
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (tipoSeleccionado === 'Musica') return;

const descripcion = (descripcionInput?.value || '').trim();
if (!tipoSeleccionado || !descripcion) return;

// 🔒 Bloqueo duro si no hay usuario activo
const usuario = localStorage.getItem('usuario_actual');
if (!usuario) {
  alert("No hay usuario activo. Inicia sesión antes de guardar.");
  return;
}

// 👇 Base del objeto a insertar en cualquier tipo
let dataToSave = { description: descripcion, usuario };

console.log('[DEBUG] usuario(localStorage):', usuario);
console.log('[DEBUG] dataToSave base:', dataToSave);




    // Receta
    if (tipoSeleccionado === 'Receta') {
      if (typeof guardarReceta === 'function') {
        await guardarReceta(usuario);
        form.reset();
        formulariosActividad.classList.add('oculto');
        tipoSeleccionado = null;
      } else {
        console.error('guardarReceta() no está disponible');
      }
      return;
    }

    // Tarea
    if (tipoSeleccionado === 'Tarea') {
      try {
        dataToSave.due_date   = document.getElementById('tarea-fecha').value;
        dataToSave.start_time = document.getElementById('tarea-hora-inicio').value;
        dataToSave.end_time   = document.getElementById('tarea-hora-fin').value;
        // === NUEVO: asignar grupo a tarea ===
dataToSave.grupo_id = document.querySelector('.select-grupo[data-target="tarea"]')?.value || null;

        const prioridadEl = document.getElementById('tarea-prioridad');
if (prioridadEl) {
  const prioridad = prioridadEl.value;
  dataToSave.priority = prioridad === 'Alta' ? 3 : prioridad === 'Media' ? 2 : 1;
}

        dataToSave.is_completed = false;

        const { error } = await supabase.from('tasks').insert([dataToSave]);
        if (error) throw error;

        form.reset();
        formulariosActividad.classList.add('oculto');
        tipoSeleccionado = null;
        if (typeof cargarAgendaHoy === 'function') cargarAgendaHoy();
        botonesActividad?.classList.add("oculto");
      } catch (error) {
        console.error('Error al guardar Tarea:', error.message);
      }
      return;
    }

   // Ingrediente (guarda como antes; el histórico visual usa ingredientes_supermercado)

// Ingrediente
if (tipoSeleccionado === 'Ingrediente') {
  try {
    // ---- helpers seguros ----
    const txt = (id) => (document.getElementById(id)?.value ?? '').toString().trim();
    const num = (id) => {
      const raw = txt(id).replace(',', '.');
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : null;
    };

    // ---- leer formulario ----
    const supermercado = (document.getElementById('ingrediente-supermercado')?.value || '').trim();
    const precio      = num('ingrediente-precio');
    const cantidad    = num('ingrediente-cantidad');
    const unidad      = txt('ingrediente-unidad') || null;
    const calorias    = num('ingrediente-calorias');
    const proteinas   = num('ingrediente-proteinas');

    if (!descripcion) { alert('Falta la descripción del ingrediente'); return; }

    // ---- completar dataToSave para la vista public.ingredientes ----
    dataToSave.supermercado = supermercado || null;
    dataToSave.precio       = precio;
    dataToSave.cantidad     = cantidad;
    dataToSave.unidad       = unidad;
    dataToSave.calorias     = calorias;
    dataToSave.proteinas    = proteinas;

    console.log('[DEBUG] usuario(localStorage):', usuario);
    console.log('[DEBUG] payload ingredientes:', dataToSave);

    // === 1) Upsert en ingredientes_base (solo base/nutrición) ===
    // Requiere índice único en nombre:
    //   create unique index if not exists ingredientes_base_nombre_key on public.ingredientes_base (nombre);
    const { data: baseRows, error: upsertError } = await supabase
      .from('ingredientes_base')
      .upsert([{
        nombre: descripcion,
        unidad: unidad,
        cantidad: cantidad,
        calorias: calorias,
        proteinas: proteinas,
        description: descripcion,        
        precio: precio,
        supermercado: supermercado,
        usuario   // ← opcional
      }], { onConflict: 'nombre' })
      .select('id');
    if (upsertError) console.warn('Aviso upsert ingredientes_base:', upsertError.message);

    const baseId = Array.isArray(baseRows) && baseRows.length ? baseRows[0].id : null;

   

    // === 3) Insert en la vista public.ingredientes (lo que usas en la app) ===
    const { data: insertedIng, error: insertError } = await supabase
      .from('ingredientes')
      .insert([dataToSave])
      .select('id, description, usuario, precio, cantidad, unidad, calorias, proteinas, supermercado');

    console.log('[DEBUG] insert ingredientes ->', { insertedIng, insertError });
    if (insertError) throw insertError;

    // reset UI
    form.reset();
    formulariosActividad.classList.add('oculto');
    tipoSeleccionado = null;
    desactivarAutocompleteIngrediente();
    if (typeof cargarAgendaHoy === 'function') cargarAgendaHoy();
    botonesActividad?.classList.add('oculto');
  } catch (error) {
    console.error('Error al guardar Ingrediente:', error.message || error);
  }
  return;
}




    // Rutina
    if (tipoSeleccionado === 'Rutina') {
      try {
        dataToSave.start_time = document.getElementById('rutina-hora-inicio').value;
        dataToSave.end_time   = document.getElementById('rutina-hora-fin').value;
        // === NUEVO: asignar grupo a rutina ===
dataToSave.grupo_id = document.querySelector('.select-grupo[data-target="rutina"]')?.value || null;

        dataToSave.days_of_week = Array.from(document.querySelectorAll('input[name="rutina_dia_semana"]:checked')).map(el => el.value);
        dataToSave.is_active  = true;
        dataToSave.date       = document.getElementById('rutina-fecha').value;
        const endDateInput = document.getElementById('rutina-fecha-fin');
        if (endDateInput && endDateInput.value) dataToSave.end_date = endDateInput.value;

        const { error } = await supabase.from('routines').insert([dataToSave]);
        if (error) throw error;

        form.reset();
        formulariosActividad.classList.add('oculto');
        tipoSeleccionado = null;
        if (typeof cargarAgendaHoy === 'function') cargarAgendaHoy();
        botonesActividad?.classList.add("oculto");
      } catch (error) {
        console.error('Error al guardar Rutina:', error.message);
      }
      return;
    }

    // Cita
    if (tipoSeleccionado === 'Cita') {
      try {
        dataToSave.date       = document.getElementById('cita-fecha').value;
        dataToSave.start_time = document.getElementById('cita-hora-inicio').value;
        dataToSave.end_time   = document.getElementById('cita-hora-fin').value;
        // === NUEVO: asignar grupo a cita ===
dataToSave.grupo_id = document.querySelector('.select-grupo[data-target="cita"]')?.value || null;


        const normalizedReqs = normalizeRequirements(requisitosCita);
        dataToSave.requirements = normalizedReqs;
        dataToSave.completed = false;

        const { data: inserted, error } = await supabase
          .from('appointments')
          .insert([dataToSave])
          .select()
          .single();
        if (error) throw error;

        const hoyStr = new Date().toISOString().split('T')[0];
        const taskRows = normalizedReqs.map((req, idx) => ({
          usuario,
          description: `[Cita] ${inserted.description} — ${req.text}`,
          due_date: hoyStr,
          is_completed: !!req.checked,
          appointment_id: inserted.id,
          grupo_id: inserted.grupo_id,

          requirement_index: idx
          
        }));
        if (taskRows.length > 0) {
          const { error: upErr } = await supabase
            .from('tasks')
            .upsert(taskRows, { onConflict: 'appointment_id,requirement_index' });
          if (upErr) console.error('⚠️ Error creando tareas de requisitos:', upErr);
        }

        if (typeof cargarCitas === 'function') cargarCitas();
        form.reset();
        requisitosCita.length = 0;
        renderizarRequisitos();
        formulariosActividad.classList.add('oculto');
        tipoSeleccionado = null;
        if (typeof cargarAgendaHoy === 'function') cargarAgendaHoy();
        botonesActividad?.classList.add("oculto");
      } catch (error) {
        console.error('Error al guardar Cita:', error.message);
      }
    }
  });

  // Atajos externos (si existen)
  document.getElementById('btn-tarea-actividad')?.addEventListener('click', () => {
    tipoSeleccionado = 'Tarea'; mostrarFormulario('Tarea');
  });
  document.getElementById('btn-rutina-actividad')?.addEventListener('click', () => {
    tipoSeleccionado = 'Rutina'; mostrarFormulario('Rutina');
  });
  document.getElementById('btn-cita-actividad')?.addEventListener('click', () => {
    tipoSeleccionado = 'Cita'; mostrarFormulario('Cita');
  });

  // Mostrar histórico al salir del nombre
  descripcionInput?.addEventListener('blur', async () => {
    if (tipoSeleccionado !== 'Ingrediente') return;
    const nombre = (descripcionInput.value || '').trim();
    if (nombre) {
      if (!selectedBaseId) await resolveBaseIdByName(nombre);
      mostrarUltimoPrecio(nombre);
      mostrarSupersGuardados(nombre);
    }
  });

  // Enter para guardar
  descripcionInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-guardar-actividad')?.click();
    }
  });
});

// refresco agenda si se borra cita fuera
window.addEventListener('cita-borrada', () => {
  if (typeof cargarAgendaHoy === 'function') cargarAgendaHoy();
});
