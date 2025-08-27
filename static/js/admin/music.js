// Lógica de música
import { $ } from './common.js';
import { supabase } from '/static/js/supabaseClient.js';

const BUCKET = 'audios';
const TABLE  = 'music';

const stripExt = (name) => name.replace(/\.[^/.]+$/, '');
const parseFromFilename = (filename) => {
  const base = stripExt(filename).trim();
  const parts = base.split(/\s*[-–—]\s*/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim() || 'Desconocido', title: parts.slice(1).join(' - ').trim() || base };
  }
  return { artist: 'Desconocido', title: base };
};

async function getUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id) return session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) return null;
  return data.user.id;
}

// refs UI
const btnMusica = $('#btn-musica-actividad');
const formMusica = $('#form-musica');
const formIngred = $('#form-ingrediente');
const formReceta = $('#form-receta');
const contFormularios = $('#formularios-actividad');
const grupoNombreDesc = $('#grupo-nombre-descripcion');
const botonesActividad = $('#botones-actividad');

const inputFiles = $('#musica-archivo-multiple');
const inputTitulo = $('#musica-titulo-opcional');
const btnSubir = $('#btn-subir-musica');
const btnCancelar = $('#btn-cancelar-musica');
const resultado = $('#musica-resultado');

// Mostrar formulario de Música
btnMusica?.addEventListener('click', () => {
  contFormularios?.classList.remove('oculto');
  formIngred?.classList.add('oculto');
  formReceta?.classList.add('oculto');
  formMusica?.classList.remove('oculto');
  grupoNombreDesc?.classList.add('oculto');
  botonesActividad?.classList.add('oculto');
  resultado.textContent = '';
});

// Cancelar
btnCancelar?.addEventListener('click', () => {
  formMusica?.classList.add('oculto');
  if (inputFiles) inputFiles.value = '';
  if (inputTitulo) inputTitulo.value = '';
  resultado.textContent = '';
});

// Subida múltiple
btnSubir?.addEventListener('click', async () => {
  const files = inputFiles?.files || [];
  const manualTitle = (inputTitulo?.value || '').trim();

  if (!files.length) { resultado.textContent = '❌ Selecciona uno o más archivos.'; return; }

  const userId = await getUserId();
  if (!userId) { resultado.textContent = '❌ No hay sesión de usuario.'; return; }

  btnSubir.disabled = true;
  btnSubir.textContent = 'Subiendo...';
  resultado.textContent = '';

  let ok = 0, fail = 0;
  const rows = [];

  for (const file of files) {
    try {
      const path = `${userId}/${Date.now()}_${file.name}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file);
      if (up.error) throw up.error;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = pub.publicUrl;

      let artist, title;
      if (files.length === 1 && manualTitle) {
        ({ artist, title } = parseFromFilename(`${manualTitle}.mp3`));
      } else {
        ({ artist, title } = parseFromFilename(file.name));
      }

      rows.push({ user_id: userId, url, title, artist });
      ok++;
    } catch (err) {
      console.error('Upload error', err);
      fail++;
    }
  }

  if (rows.length) {
    const { error } = await supabase.from(TABLE).insert(rows);
    if (error) {
      console.error('Insert error', error);
      resultado.textContent = `⚠️ Subidas OK: ${ok}, errores: ${fail}. (Fallo al guardar en tabla)`;
    } else {
      resultado.textContent = `✅ Subidas OK: ${ok}, errores: ${fail}.`;
    }
  } else {
    resultado.textContent = `⚠️ No se pudo subir ningún archivo.`;
  }

  btnSubir.disabled = false;
  btnSubir.textContent = 'Subir música';
  if (inputFiles) inputFiles.value = '';
  if (inputTitulo) inputTitulo.value = '';
});
