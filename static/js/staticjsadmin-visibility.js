// static/js/admin-visibility.js
import { supabase } from './supabaseClient.js';

const ADMIN_SELECTORS = ['#admin-acceso', '#admin-btn']; // botón largo y (si lo pones) el engranaje del header

function hideAdminUI() {
  ADMIN_SELECTORS.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.classList.add('oculto'); // ya tienes .oculto en tu CSS
  });
}

function onReady(fn){
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

onReady(async () => {
  try {
    const username = localStorage.getItem('usuario_actual');
    if (!username) return hideAdminUI(); // por defecto oculto si no sabemos quién es

    // lee el rol desde tu tabla 'usuarios'
    const { data, error } = await supabase
      .from('usuarios')
      .select('role')
      .eq('username', username)
      .maybeSingle();

    if (error) return hideAdminUI();   // si falla, oculto
    const role = data?.role || 'user'; // por defecto user

    if (role !== 'admin') hideAdminUI(); // solo admin lo ve
    // si es admin, no hacemos nada: queda visible
  } catch {
    hideAdminUI();
  }
});
