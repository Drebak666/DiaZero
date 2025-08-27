// Admin grupos (solo actúa si la sección existe)
import { supabase } from "./supabaseClient.js";

// ───────── helpers ─────────
const $ = (id) => document.getElementById(id);
const on = (id, ev, fn) => { const n = $(id); if (n) n.addEventListener(ev, fn); };
const ready = (fn) => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); };

// ───────── refs (pueden ser null si quitaste inputs) ─────────
const grpNombre   = $("grp-nombre");
const btnCrear    = $("grp-crear");
const misGrupos   = $("mis-grupos");
const panelM      = $("panel-miembros");
const nombreGA    = $("nombre-grupo-actual");
const mUser       = $("mbr-username");
const mRol        = $("mbr-rol");
const btnMAdd     = $("mbr-agregar");
const ulMiembros  = $("lista-miembros");

let grupoActual = null;

// Crear grupo
btnCrear?.addEventListener("click", async (e) => {
  e.preventDefault();
  const nombre = (grpNombre?.value || "").trim();
  if (!nombre) return alert("Pon un nombre de grupo.");

  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) return alert("No hay usuario autenticado.");
  const uid = user.id;

  const { data: g, error: e2 } = await supabase
    .from("grupos")
    .insert({ nombre, admin_id: uid })
    .select("id")
    .single();
  if (e2) return alert("Error creando grupo: " + e2.message);

  const { error: e3 } = await supabase
    .from("miembros_grupo")
    .insert({ grupo_id: g.id, usuario_id: uid, role: "admin" });
  if (e3) return alert("Grupo creado pero no se pudo añadirte como miembro: " + e3.message);

  if (grpNombre) grpNombre.value = "";
  await cargarMisGrupos();
  alert("Grupo creado.");
});

// Lista TODOS los grupos donde soy miembro
async function cargarMisGrupos() {
  if (!misGrupos) return; // página sin sección → no hacer nada
  misGrupos.innerHTML = "Cargando…";

  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) { misGrupos.textContent = "No autenticado."; return; }
  const uid = user.id;

  // 1) IDs de grupos donde soy miembro
  const { data: memb, error: e1 } = await supabase
    .from("miembros_grupo")
    .select("grupo_id")
    .eq("usuario_id", uid);

  if (e1) { misGrupos.textContent = "Error cargando grupos."; return; }
  const ids = (memb || []).map(r => r.grupo_id);
  if (!ids.length) {
    misGrupos.innerHTML = "<p>No perteneces a ningún grupo todavía.</p>";
    panelM?.classList.add("oculto");
    grupoActual = null;
    return;
  }

  // 2) Datos de esos grupos
  const { data: grupos, error: e2 } = await supabase
    .from("grupos")
    .select("id, nombre")
    .in("id", ids)
    .order("nombre", { ascending: true });

  if (e2) { misGrupos.textContent = "Error cargando grupos."; return; }

  misGrupos.innerHTML = grupos.map(g => `
    <button class="btn-secondary" data-gid="${g.id}" data-nombre="${g.nombre}">
      ${g.nombre}
    </button>
  `).join(" ");

  misGrupos.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", async () => {
      grupoActual = { id: b.dataset.gid, nombre: b.dataset.nombre };
      if (nombreGA) nombreGA.textContent = grupoActual.nombre;
      panelM?.classList.remove("oculto");
      await cargarMiembros();
    });
  });
}

// Carga miembros del grupo seleccionado
async function cargarMiembros() {
  if (!ulMiembros) return;
  ulMiembros.innerHTML = "Cargando…";
  if (!grupoActual) return;

  const { data, error } = await supabase
    .from("miembros_grupo")
    .select("usuario_id, role, usuarios:usuario_id ( username, email )")
    .eq("grupo_id", grupoActual.id)
    .order("role", { ascending: true });

  if (error) { ulMiembros.textContent = "Error cargando miembros."; return; }

  ulMiembros.innerHTML = (data || []).map(m =>
    `<li>${m.usuarios?.username || m.usuarios?.email || m.usuario_id} — <em>${m.role}</em></li>`
  ).join("");
}

// Añadir miembro por username
btnMAdd?.addEventListener("click", async () => {
  if (!grupoActual) return alert("Selecciona un grupo.");
  const u = (mUser?.value || "").trim();
  if (!u) return alert("Indica el username del miembro.");

  const { data: urow, error: ue } = await supabase
    .from("usuarios")
    .select("id")
    .eq("username", u)
    .maybeSingle();
  if (ue || !urow) return alert("No existe ese username.");

  const { error } = await supabase
    .from("miembros_grupo")
    .insert({ grupo_id: grupoActual.id, usuario_id: urow.id, role: (mRol?.value || "miembro") });
  if (error) return alert("Error añadiendo miembro: " + error.message);

  if (mUser) mUser.value = "";
  await cargarMiembros();
  alert("Miembro añadido.");
});

// Arranque seguro
ready(() => { if (misGrupos) cargarMisGrupos(); });
