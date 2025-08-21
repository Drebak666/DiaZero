// documentos.js
import { supabase } from "./supabaseClient.js";
import { getUsuarioActivo } from "./usuario.js";

/* ===== Utilidades de fecha ===== */
function formatDMY(dateStr){
  if(!dateStr) return '';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return `${dd}-${mm}-${yy}`;
}
function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.round((d - t) / (1000*60*60*24));
}
function reminderDateFrom(expStr) {
  const exp = new Date(expStr);
  exp.setDate(exp.getDate() - 30);
  const today = new Date(); today.setHours(0,0,0,0);
  if (exp < today) return toYMD(today);
  return toYMD(exp);
}

/* ===== DOM ===== */
const formulario   = document.getElementById("formulario-documento");
const lista        = document.getElementById("lista-documentos");
const selectorTipo = document.getElementById("filtro-tipo");
const tipoInput    = document.getElementById("tipo");
const cancelarBtn  = document.getElementById("cancelar-edicion");

/* ===== Carga inicial ===== */
async function cargarDocumentos() {
  if (!lista || !selectorTipo) return;
  lista.innerHTML = "";
  selectorTipo.innerHTML = '<option value="todos">Todos</option>';

  const usuario = await getUsuarioActivo();
  if (!usuario) return;

  const { data, error } = await supabase
    .from("documentos")
    .select("*")
    .eq("usuario", usuario)
    .order("caduca_el", { ascending: true, nullsFirst: false }) // por caducidad
    .order("created_at", { ascending: true });                   // desempate

  if (error) { console.error("Error cargando documentos:", error); return; }

  // Rellenar filtro de tipos (arreglo el bug de Set)
  const tipos = Array.from(new Set((data || []).map(d => d.tipo).filter(Boolean)));
  tipos.forEach(t => {
    const o = document.createElement("option");
    o.value = t; o.textContent = t;
    selectorTipo.appendChild(o);
  });

  (data || []).forEach(doc => renderDocumento(doc));
}

/* ===== Pintar tarjeta (centrada + botones 3 columnas) ===== */
function renderDocumento(doc) {
  const div = document.createElement("div");
  div.className = "doc-item mb-2";
  div.dataset.id = doc.id;

  if (doc.caduca_el) {
    const dLeft = daysUntil(doc.caduca_el);
    if (dLeft < 0)       div.classList.add('expired');
    else if (dLeft === 0)div.classList.add('today');
    else if (dLeft <=30) div.classList.add('soon');
  }

  const nombre = document.createElement("strong");
  nombre.textContent = doc.nombre;

  const tipo = document.createElement("em");
  tipo.textContent = ` (${doc.tipo})`;

  const fechaTxt = document.createElement("span");
  if (doc.caduca_el) {
    const dLeft = daysUntil(doc.caduca_el);
    const isAlert = dLeft <= 30;
    fechaTxt.className = `exp-date${isAlert ? ' alert' : ''}`;
    fechaTxt.textContent = ` — ${formatDMY(doc.caduca_el)}`;
  }

  const br = document.createElement("br");

  // Botones
  const enlace = document.createElement("a");
  const url = supabase.storage.from("documentos").getPublicUrl(doc.archivo_url).data.publicUrl;
  enlace.href = url; enlace.target = "_blank";
  enlace.textContent = "Ver Archivo";
  enlace.className = "btn btn-primary";

  const btnEditar = document.createElement("button");
  btnEditar.className = "btn btn-warning";
  btnEditar.textContent = "Editar";
  btnEditar.onclick = () => {
    document.getElementById("nombre").value = doc.nombre;
    document.getElementById("tipo").value = doc.tipo;
    document.getElementById("caduca_el").value = doc.caduca_el || "";
    formulario.setAttribute("data-id-editar", doc.id);
    cancelarBtn.style.display = "inline-block";
    document.getElementById("app").scrollIntoView({ behavior: "smooth" });
  };

  const btnBorrar = document.createElement("button");
  btnBorrar.className = "btn btn-danger";
  btnBorrar.textContent = "Borrar";
  btnBorrar.onclick = () => borrarDocumento(doc.id);

  // Acciones en 3 columnas
  const acciones = document.createElement("div");
  acciones.className = "doc-actions";
  acciones.append(enlace, btnEditar, btnBorrar);

  // Montaje (una sola vez – eliminamos la duplicación que tenías). :contentReference[oaicite:1]{index=1}
  div.append(nombre, tipo);
  if (doc.caduca_el) div.append(fechaTxt);
  div.append(br, acciones);

  lista.appendChild(div);
}

/* ===== Subir archivo a Storage ===== */
async function subirArchivo(archivo) {
  const nombreArchivo = `${Date.now()}_${archivo.name}`;
  const { data, error } = await supabase.storage.from("documentos").upload(nombreArchivo, archivo);
  if (error) { console.error("Error subiendo archivo:", error); return null; }
  return data.path; // se guarda como archivo_url
}

/* ===== Crear/actualizar tarea de aviso a -30 días ===== */
async function upsertTareaCaducidad({ documentId, nombre, caducaEl, usuario }) {
  if (!caducaEl) return;
  const due = reminderDateFrom(caducaEl);

  const row = {
    document_id: documentId,
    description: `Renovar: ${nombre}`,
    due_date: due,   // hoy si faltan ≤30 días; si no, -30 días
    usuario: usuario
  };

  // Limpia otras fechas de ese doc y luego upsert
  await supabase
    .from("tasks")
    .delete()
    .eq("document_id", documentId)
    .neq("due_date", due);

  const { error } = await supabase
    .from("tasks")
    .upsert([row], { onConflict: "document_id,due_date" });

  if (error) console.error("Error creando tarea de caducidad:", error);
} // 👈👈👈 Cierra aquí la función


/* ===== Guardar / Editar ===== */
if (formulario) {
  formulario.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nombre = document.getElementById("nombre").value.trim();
    const tipo = tipoInput.value.trim();
    const caducaEl = document.getElementById("caduca_el").value || null;
    const archivo = document.getElementById("archivo").files[0];
    const usuario = await getUsuarioActivo();
    const idEditar = formulario.getAttribute("data-id-editar");

    if (!nombre || !tipo || !usuario) return;

    if (idEditar) {
      const updateData = { nombre, tipo, caduca_el: caducaEl };
      if (archivo) {
        const archivo_url = await subirArchivo(archivo);
        if (!archivo_url) return;
        updateData.archivo_url = archivo_url;
      }
      const { error } = await supabase.from("documentos").update(updateData).eq("id", idEditar);
      if (error) { console.error("Error al actualizar:", error); return; }
      await upsertTareaCaducidad({ documentId: idEditar, nombre, caducaEl, usuario });
    } else {
      if (!archivo) return;
      const archivo_url = await subirArchivo(archivo);
      if (!archivo_url) return;
      const { data, error } = await supabase
        .from("documentos")
        .insert([{ nombre, tipo, archivo_url, usuario, caduca_el: caducaEl }])
        .select("id")
        .single();
      if (error) { console.error("Error guardando documento:", error); return; }
      await upsertTareaCaducidad({ documentId: data.id, nombre, caducaEl, usuario });
    }

    formulario.reset();
    formulario.removeAttribute("data-id-editar");
    cancelarBtn.style.display = "none";
    cargarDocumentos();
  });
}

/* Cancelar edición */
if (cancelarBtn) {
  cancelarBtn.addEventListener("click", () => {
    formulario.reset();
    formulario.removeAttribute("data-id-editar");
    cancelarBtn.style.display = "none";
  });
}

/* ===== Borrar ===== */
async function borrarDocumento(id) {
  await supabase.from("tasks").delete().eq("document_id", id);
  const { error } = await supabase.from("documentos").delete().eq("id", id);
  if (error) { console.error("Error al borrar:", error); return; }
  cargarDocumentos();
}

/* ===== Filtro por tipo ===== */
if (selectorTipo) {
  selectorTipo.addEventListener("change", async () => {
    const tipoSel = selectorTipo.value;
    const usuario = await getUsuarioActivo();

    let query = supabase
      .from("documentos")
      .select("*")
      .eq("usuario", usuario)
      .order("caduca_el", { ascending: true })
      .order("created_at", { ascending: true });

    if (tipoSel !== "todos") query = query.eq("tipo", tipoSel);

    const { data, error } = await query;
    if (error) { console.error("Error filtrando:", error); return; }

    // Orden estable: caduca primero, luego sin fecha al final
    const docs = (data || []).slice().sort((a,b) => {
      const ta = a.caduca_el ? new Date(a.caduca_el).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.caduca_el ? new Date(b.caduca_el).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    lista.innerHTML = "";
    docs.forEach(doc => renderDocumento(doc));
  });
}

/* Inicio */
document.addEventListener("DOMContentLoaded", cargarDocumentos);
