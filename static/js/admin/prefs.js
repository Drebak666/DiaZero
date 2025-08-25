import { $, getUsername } from './common.js';

const DEFAULT_APT = [-43200, -21600, -1440, -60];
const username = getUsername();

function currentAptOffsets() {
  const list = document.getElementById('apt_list');
  if (!list) return [];
  return [...list.querySelectorAll('span[data-min]')].map(s => parseInt(s.dataset.min, 10));
}

async function loadPrefs() {
  try {
    const r = await fetch(`/api/notification-prefs?username=${encodeURIComponent(username)}`);
    const data = await r.json();
    if (!r.ok || !data.ok) return console.warn('No se pudieron cargar prefs', data);

    const prefs = data.prefs || {};
    const rut = prefs.routines?.offsets?.[0] ?? -15;
    const tas = prefs.tasks?.offsets?.[0] ?? -15;
    const apt = prefs.appointments?.offsets ?? [];

    $('#rut_mins').value = Math.abs(rut);
    $('#tas_mins').value = Math.abs(tas);

    const list = $('#apt_list');
    list.innerHTML = '';
    apt.slice(0, 3).forEach(v => {
      const chip = document.createElement('span');
      chip.dataset.min = String(v);
      chip.textContent = `${Math.abs(v)} min antes `;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.onclick = () => chip.remove();
      chip.appendChild(x);
      list.appendChild(chip);
    });
  } catch (e) {
    console.error('Error cargando prefs', e);
  }
}

document.getElementById('notify-prefs')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const rut = parseInt($('#rut_mins')?.value ?? '15', 10);
  const tas = parseInt($('#tas_mins')?.value ?? '15', 10);

  const rutOff = -Math.abs(isFinite(rut) ? rut : 15);
  const tasOff = -Math.abs(isFinite(tas) ? tas : 15);

  let apt = currentAptOffsets();
  if (!apt.length) apt = DEFAULT_APT;
  apt = apt.slice(0, 3).map(n => (n <= 0 ? n : -Math.abs(n)));

  console.log('Payload enviado →', { username,
    routines:{offsets:[rutOff]}, tasks:{offsets:[tasOff]}, appointments:{offsets:apt} });

  try {
    const r = await fetch('/api/notification-prefs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        username,
        routines:     { offsets: [rutOff] },
        tasks:        { offsets: [tasOff] },
        appointments: { offsets: apt }
      })
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) console.log('Preferencias guardadas');
    else { console.warn('Guardar falló', r.status, data); alert('No se pudo guardar preferencias.'); }
  } catch (err) {
    console.error('savePrefs error', err);
    alert('Error de red guardando preferencias.');
  }
});

document.getElementById('apt_add')?.addEventListener('click', () => {
  const valEl = document.getElementById('apt_custom_val');
  const unitEl = document.getElementById('apt_custom_unit');
  const list   = document.getElementById('apt_list');
  if (!valEl || !unitEl || !list) return;

  let v = parseInt(valEl.value, 10);
  if (!isFinite(v) || v <= 0) return;

  const u = unitEl.value;
  if (u === 'h') v *= 60;
  if (u === 'd') v *= 1440;
  v = -Math.abs(v);

  const curr = currentAptOffsets();
  if (curr.length >= 3) return alert('Máximo 3 alarmas');

  const chip = document.createElement('span');
  chip.dataset.min = String(v);
  chip.textContent  = `${Math.abs(v)} min antes `;
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.onclick = () => chip.remove();
  chip.appendChild(x);
  list.appendChild(chip);
});

loadPrefs();
