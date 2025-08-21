// static/js/admin-groups.js
import { supabase } from "./supabaseClient.js";

const username = localStorage.getItem("usuario_actual");

// UI refs
const grpNombre   = document.getElementById("grp-nombre");
const btnCrear    = document.getElementById("grp-crear");
const misGrupos   = document.getElementById("mis-grupos");
const panelM      = document.getElementById("panel-miembros");
const nombreGA    = document.getElementById("nombre-grupo-actual");
const mUser       = document.getElementById("mbr-username");
const mRol        = document.getElementById("mbr-rol");
const btnMAdd     = document.getElementById("mbr-agregar");
const ulMiembros  = document.getElementById("lista-miembros");

let grupoActual = null;

// Crear grupo
btnCrear?.addEventListener("click", async (e) => {
  e.preventDefault();
  const nombre = (grpNombre.value || "").trim();
  if (!nombre) return alert("Pon un nombre de grupo.");

  const username = localStorage.getItem("usuario_actual") || "";

  // 1) resolver mi UUID en 'usuarios'
  const { data: me, error: e1 } = await supabase
    .from("usuarios")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (e1 || !me) return alert("No pude obtener tu id de usuario.");

  // 2) crear grupo con admin_id
  const { error: e2 } = await supabase
    .from("grupos")
    .insert({ nombre, admin_id: me.id });
  if (e2) return alert("Error creando grupo: " + e2.message);

  grpNombre.value = "";
  await cargarMisGrupos();
  alert("Grupo creado.");
});


async function cargarMisGrupos() {
  misGrupos.innerHTML = "Cargando…";

  const username = localStorage.getItem("usuario_actual") || "";
  const { data: me, error: e1 } = await supabase
    .from("usuarios")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (e1 || !me) {
    misGrupos.textContent = "Error resolviendo usuario.";
    return;
  }

  const { data, error } = await supabase
    .from("grupos")
    .select("*")
    .eq("admin_id", me.id)
    .order("nombre", { ascending: true });

  if (error) {
    misGrupos.textContent = "Error cargando grupos.";
    return;
  }

  if (!data || data.length === 0) {
    misGrupos.innerHTML = "<p>No tienes grupos todavía.</p>";
    panelM.classList.add("oculto");
    grupoActual = null;
    return;
  }

  misGrupos.innerHTML = data.map(g => `
    <button class="btn-secondary" data-gid="${g.id}" data-nombre="${g.nombre}">
      ${g.nombre}
    </button>
  `).join(" ");

  misGrupos.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", async () => {
      grupoActual = { id: b.dataset.gid, nombre: b.dataset.nombre };
      nombreGA.textContent = grupoActual.nombre;
      panelM.classList.remove("oculto");
      await cargarMiembros();
    });
  });
}


async function cargarMiembros() {
  ulMiembros.innerHTML = "Cargando…";

  // Hacemos join con 'usuarios' para obtener el username
  const { data, error } = await supabase
    .from("miembros_grupo")
    .select("id, role, usuarios:usuario_id ( username )")
    .eq("grupo_id", grupoActual.id)
    .order("role", { ascending: true });

  if (error) {
    ulMiembros.textContent = "Error cargando miembros.";
    return;
  }

  ulMiembros.innerHTML = (data || []).map(m =>
    `<li>${m.usuarios?.username || '—'} — <em>${m.role}</em></li>`
  ).join("");
}


btnMAdd?.addEventListener("click", async () => {
  if (!grupoActual) return alert("Selecciona un grupo.");
  const u = (mUser.value || "").trim();
  if (!u) return alert("Indica el username del miembro.");

  // 1) Buscar el UUID del usuario por su username
  const { data: urow, error: ue } = await supabase
    .from("usuarios")
    .select("id")
    .eq("username", u)
    .maybeSingle();

  if (ue || !urow) return alert("No existe ese username.");

  // 2) Insertar usando usuario_id (NO username)
  const { error } = await supabase
    .from("miembros_grupo")
    .insert({
      grupo_id: grupoActual.id,
      usuario_id: urow.id,
      role: mRol.value || "miembro"
    });

  if (error) return alert("Error añadiendo miembro: " + error.message);
  mUser.value = "";
  await cargarMiembros();
  alert("Miembro añadido.");
});


// arranque
cargarMisGrupos();
