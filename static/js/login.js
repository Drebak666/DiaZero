// static/js/login.js
import { supabase } from './supabaseClient.js';

// === OneSignal: vincular usuario ===
async function linkOneSignal(userId) {
  try {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function (OneSignal) {
      // Pide permiso (puedes cambiarlo a un botón más tarde)
      if (OneSignal.Slidedown?.promptPush) {
        await OneSignal.Slidedown.promptPush();
      } else if (OneSignal.Notifications?.requestPermission) {
        await OneSignal.Notifications.requestPermission();
      }
      // Vincula identidad (SDK v16)
if (OneSignal.login) {
  await OneSignal.login(userId);
} else if (OneSignal.setExternalUserId) {
  // compatibilidad SDK antiguo
  await OneSignal.setExternalUserId(userId);
}
    });
  } catch (e) {
    console.error("OneSignal link:", e);
  }
}


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
if (showRegisterFormLink && loginSection && registerSection) {
  showRegisterFormLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginSection.classList.add('hidden-form');
    registerSection.classList.remove('hidden-form');
    loginErrorMsg.textContent = '';
    registerErrorMsg.textContent = '';
    registerSuccessMsg.textContent = '';
  });
}

if (showLoginFormLink && loginSection && registerSection) {
  showLoginFormLink.addEventListener('click', (e) => {
    e.preventDefault();
    registerSection.classList.add('hidden-form');
    loginSection.classList.remove('hidden-form');
    loginErrorMsg.textContent = '';
    registerErrorMsg.textContent = '';
    registerSuccessMsg.textContent = '';
  });
}

/* ============================
   REGISTRO (sign up) — SIEMPRE ADMIN
   ============================ */
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = registerUsernameInput.value.trim();
    const password = registerPasswordInput.value.trim();

    // Validaciones
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
      // 1) Crear usuario en Auth
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;

      const userId = data?.user?.id;
      if (!userId) {
        // si requiere verificación por email, seguimos con la fila en usuarios usando username
        // (pero normalmente data.user.id viene)
        registerSuccessMsg.textContent = 'Registro realizado. Revisa tu correo para verificar la cuenta.';
      }

      // 2) Upsert en tabla 'usuarios' → role = 'admin' garantizado
      const { error: upsertErr } = await supabase
        .from('usuarios')
        .upsert(
          { id: userId, username: email, role: 'admin' },
          { onConflict: 'id' }
        )
        .select('id')
        .single();

      if (upsertErr) throw upsertErr;

      // 3) Iniciar sesión automáticamente
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        registerSuccessMsg.textContent = 'Registro exitoso. Por favor inicia sesión manualmente.';
        return;
      }

      // 4) Leer perfil, corregir rol si hiciera falta, y guardar en localStorage
      let { data: perfil, error: userError } = await supabase
        .from('usuarios')
        .select('username, role')
        .eq('id', userId)
        .single();

      if (userError) throw userError;

      if (!perfil?.role || perfil.role !== 'admin') {
        const { data: fixed } = await supabase
          .from('usuarios')
          .update({ role: 'admin' })
          .eq('id', userId)
          .select('username, role')
          .single();
        if (fixed) perfil = fixed;
      }

      localStorage.setItem('usuario_actual', perfil.username);
      localStorage.setItem('rol_usuario', perfil.role);
      // Vincular usuario con OneSignal
await linkOneSignal(userId);

window.location.href = '/';

    } catch (error) {
      console.error('Error en registro:', error);

      if (String(error.message || '').includes('duplicate key value')) {
        // Si ya existe, intentar iniciar sesión
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          registerErrorMsg.textContent = 'El usuario ya existe. Inicia sesión.';
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          let { data: perfil } = await supabase
            .from('usuarios')
            .select('username, role')
            .eq('id', user.id)
            .single();

          if (!perfil) {
            // crea fila si faltara
            await supabase.from('usuarios').upsert({ id: user.id, username: email, role: 'admin' }, { onConflict: 'id' });
            ({ data: perfil } = await supabase
              .from('usuarios')
              .select('username, role')
              .eq('id', user.id)
              .single());
          } else if (perfil.role !== 'admin') {
            const { data: fixed } = await supabase
              .from('usuarios')
              .update({ role: 'admin' })
              .eq('id', user.id)
              .select('username, role')
              .single();
            if (fixed) perfil = fixed;
          }

          localStorage.setItem('usuario_actual', perfil.username);
localStorage.setItem('rol_usuario', perfil.role);

// Vincular usuario con OneSignal
await linkOneSignal(user.id);

window.location.href = '/';

        }
      } else {
        registerErrorMsg.textContent = error.message || 'No se pudo completar el registro.';
      }
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
        .eq('id', userId)
        .maybeSingle();

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
          .eq('id', userId)
          .select('username, role')
          .single();
        if (fixErr) throw fixErr;
        perfil = fixed;
      }

      localStorage.setItem('usuario_actual', perfil.username);
localStorage.setItem('rol_usuario', perfil.role);
await linkOneSignal(userId);           // ← AÑADIR ESTA LÍNEA
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
