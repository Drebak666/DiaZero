// static/js/login.js
import { supabase } from './supabaseClient.js';




// Obtener referencias a las secciones y enlaces de alternancia
const loginSection = document.getElementById('login-section');
const registerSection = document.getElementById('register-section');
const showRegisterFormLink = document.getElementById('show-register-form');
const showLoginFormLink = document.getElementById('show-login-form');

// Formularios
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginErrorMsg = document.getElementById('login-error-msg');
const loginButton = loginForm?.querySelector('button[type="submit"]');

const registerForm = document.getElementById('register-form');
const registerUsernameInput = document.getElementById('register-username');
const registerPasswordInput = document.getElementById('register-password');
const registerErrorMsg = document.getElementById('register-error-msg');
const registerSuccessMsg = document.getElementById('register-success-msg');
const registerButton = registerForm?.querySelector('button[type="submit"]');

// Validación de email
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Mostrar / ocultar formularios
// ==== Mostrar / ocultar formularios con estado persistente ====
const pageTitle = document.getElementById('page-title');

function setView(view) {
  const isRegister = view === 'register';
  if (loginSection && registerSection) {
    // Evita que cualquier otro código “devuelva” el estado
    loginSection.classList.toggle('hidden-form', isRegister);
    registerSection.classList.toggle('hidden-form', !isRegister);
  }
  if (pageTitle) {
    pageTitle.textContent = isRegister ? 'Registro' : 'Iniciar sesión';
  }
  // Persistimos la vista (útil si hay recargas ligeras)
  sessionStorage.setItem('authView', isRegister ? 'register' : 'login');
}

// Arranque: prioriza hash (#register/#login), luego sessionStorage
const initialView =
  (location.hash === '#register') ? 'register' :
  (location.hash === '#login') ? 'login' :
  (sessionStorage.getItem('authView') || 'login');

setView(initialView);

// Responder a cambios de hash (si el usuario toca los enlaces)
window.addEventListener('hashchange', () => {
  const view = (location.hash === '#register') ? 'register' : 'login';
  setView(view);
});

// Enlaces
if (showRegisterFormLink) {
  showRegisterFormLink.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    setView('register');
    if (location.hash !== '#register') history.replaceState(null, '', '#register');
  });
}

if (showLoginFormLink) {
  showLoginFormLink.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    setView('login');
    if (location.hash !== '#login') history.replaceState(null, '', '#login');
  });
}


/* ============================
   REGISTRO (sign up) — SIEMPRE ADMIN
   ============================ */
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawEmail = registerUsernameInput.value;
    const email = rawEmail?.normalize('NFKC').trim().toLowerCase();
    const password = registerPasswordInput.value.trim();

    if (!isValidEmail(email)) {
      registerErrorMsg.textContent = 'Por favor ingresa un email válido';
      return;
    }
    if (password.length < 6) {
      registerErrorMsg.textContent = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }

    registerErrorMsg.textContent = '';
    registerSuccessMsg.textContent = '';
    if (registerButton) {
      registerButton.disabled = true;
      registerButton.textContent = 'Registrando...';
    }

    try {
      // 1) Crear usuario
      const { data: signData, error: signUpError } = await supabase.auth.signUp({ email, password });

      // 1.1) Si ya estaba registrado → iniciar sesión
      if (signUpError) {
        const msg = String(signUpError.message || '').toLowerCase();
        if (signUpError.status === 422 || msg.includes('already')) {
          const { error: siErr } = await supabase.auth.signInWithPassword({ email, password });
          if (siErr) throw siErr;
        } else {
          throw signUpError;
        }
      }

      // 2) userId seguro (ANTES de tocar tu tabla)
      const { data: sessionData } = await supabase.auth.getUser();
      const userId = sessionData?.user?.id;
      if (!userId) throw new Error('No se recibió el id del usuario');

      // 3) Upsert en TU tabla CON id (no uuid) y conflicto por 'id'
      const { error: upsertErr } = await supabase
        .from('usuarios')
.upsert({ id: userId, username: email, role: 'admin' }, { onConflict: 'id' })
      if (upsertErr) throw upsertErr;

      // 4) Leer perfil y forzar admin si hiciera falta (usando id)
      let { data: perfil, error: selErr } = await supabase
        .from('usuarios')
        .select('username, role')
        .eq('id', userId)
        .single();
      if (selErr) throw selErr;

      if (perfil?.role !== 'admin') {
        const { data: fixed, error: fixErr } = await supabase
          .from('usuarios')
          .update({ role: 'admin' })
          .eq('id', userId)
          .select('username, role')
          .single();
        if (fixErr) throw fixErr;
        if (fixed) perfil = fixed;
      }

      localStorage.setItem('usuario_actual', perfil.username);
      localStorage.setItem('rol_usuario', perfil.role);
      window.location.href = '/';

    } catch (error) {
      console.error('Error en registro:', error);
      registerErrorMsg.textContent = error.message || 'No se pudo completar el registro.';
    } finally {
      if (registerButton) {
        registerButton.disabled = false;
        registerButton.textContent = 'Registrar';
      }
    }
  });
}


/* ============================
   LOGIN (sign in) — AUTO-CREA ADMIN SI FALTA
   ============================ */
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value.trim();

    loginErrorMsg.textContent = '';
    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = 'Iniciando sesión...';
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const userId = data?.user?.id;

      // Buscar perfil; si no está, lo creo como admin; si está con otro rol, lo elevo a admin
      let { data: perfil, error: selErr } = await supabase
        .from('usuarios')
        .select('username, role')
.eq('id', userId).maybeSingle();


      if (selErr) throw selErr;

      if (!perfil) {
         const { data: inserted, error: insErr } = await supabase
   .from('usuarios')
   .upsert({ id: userId, username: email, role: 'admin' }, { onConflict: 'id' })
   .select('username, role')
   .single();
        if (insErr) throw insErr;
        perfil = inserted;
      } else if (perfil.role !== 'admin') {
        const { data: fixed, error: fixErr } = await supabase
          .from('usuarios')
          .update({ role: 'admin' })
.eq('id', userId)          .select('username, role')
          .single();
        if (fixErr) throw fixErr;
        perfil = fixed;
      }

      localStorage.setItem('usuario_actual', perfil.username);
localStorage.setItem('rol_usuario', perfil.role);
window.location.href = '/';


    } catch (error) {
      console.error('Error en inicio de sesión:', error);
      if (String(error.message || '').includes('Email not confirmed')) {
        loginErrorMsg.textContent = 'Debes verificar tu correo electrónico antes de iniciar sesión.';
      } else if (String(error.message || '').includes('Invalid login credentials')) {
        loginErrorMsg.textContent = 'Email o contraseña incorrectos.';
      } else {
        loginErrorMsg.textContent = error.message || 'No se pudo iniciar sesión. Verifica tus credenciales.';
      }
    } finally {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = 'Entrar';
      }
    }
  });
}
