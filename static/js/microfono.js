// === microfono.js ===
// Modal + reconocimiento de voz + intents + envío a la APP (iframe) por postMessage
// Mejora de frases completas: continuous, maxAlternatives, reintento en silencio y timer de silencio

let keepListening = false;
let silenceTimer = null;
const SILENCE_MS = 1200; // tiempo sin voz para considerar que terminó la frase

(() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Elementos UI del shell
  const micBtn    = document.getElementById('mini-mic');
  const modal     = document.getElementById('voice-modal');
  const liveBox   = document.getElementById('voice-live');
  const btnClose  = document.getElementById('voice-close');
  const btnCopy   = document.getElementById('voice-copy');
  const btnPaste  = document.getElementById('voice-paste');
  const btnCreate = document.getElementById('voice-create');
  const frame     = document.getElementById('app-frame');

  // Estado del reconocimiento
  let recognition = null;
  let escuchando  = false;
  let finalText   = '';

  // ========= Helpers de texto/fecha =========
  const MONTHS = {
    'enero':0,'febrero':1,'marzo':2,'abril':3,'mayo':4,'junio':5,
    'julio':6,'agosto':7,'septiembre':8,'setiembre':8,'octubre':9,'noviembre':10,'diciembre':11
  };
  const norm = (s='') => (s || '')
  .toLowerCase()
  .replace(/\s+/g,' ')
  .trim();


  const today0 = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
  const tomorrow0 = () => { const d=today0(); d.setDate(d.getDate()+1); return d; };

  function parseDateTime(txtRaw){
  // Usamos tu norm(): minúsculas + espacios compactados (sin quitar acentos)
  let text = ' ' + norm(txtRaw || '') + ' ';
  let date = null, time = null;

  // -------- Meridiem / Franjas del día --------
  // Marca si hay indicación de mañana/tarde/noche/madrugada o am/pm
// ---------- MERIDIEM / FRANJAS ----------
let mer = null; // 'am' | 'pm' | 'night' | 'dawn' | 'noon' | 'midnight'
const MER_PATTS = [
  // mañana
  { re: /\besta\s+mañana\b|\besta\s+manana\b|\bpor\s+la\s+mañana\b|\bpor\s+la\s+manana\b|\bde\s+la\s+mañana\b|\bde\s+la\s+manana\b/g, mer: 'am' },
  // tarde
  { re: /\besta\s+tarde\b|\bpor\s+la\s+tarde\b|\bde\s+la\s+tarde\b/g, mer: 'pm' },
  // noche
  { re: /\besta\s+noche\b|\bpor\s+la\s+noche\b|\bde\s+la\s+noche\b/g, mer: 'pm' },
  // madrugada
  { re: /\besta\s+madrugada\b|\bpor\s+la\s+madrugada\b|\bde\s+la\s+madrugada\b/g, mer: 'dawn' },
  // am/pm literales
  { re: /\bam\b|\ba\.m\.\b/g, mer: 'am' },
  { re: /\bpm\b|\bp\.m\.\b/g, mer: 'pm' },
  // especiales
  { re: /\bal\s+mediod[ií]a\b|\bmediod[ií]a\b/g, mer: 'noon' },      // 12:00
  { re: /\ba\s+medianoche\b|\bmedianoche\b/g, mer: 'midnight' }      // 00:00
];
for (const p of MER_PATTS){
  if (p.re.test(text)) {
    mer = p.mer;
    text = text.replace(p.re, ' ');
  }
}


  // -------- Hora explícita "a las HH(:MM)" --------
const t = text.match(/\b(?:a|sobre)\s+la?s\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (t){
    let hh = Math.min(23, parseInt(t[1],10));
    let mm = t[2] ? Math.min(59, parseInt(t[2],10)) : 0;

    // Ajuste por meridiem si lo hay
    if (mer === 'pm' || mer === 'night') {
      if (hh < 12) hh += 12;          // 1..11 pm -> 13..23
    } else if (mer === 'am' || mer === 'dawn') {
      if (hh === 12) hh = 0;          // 12 am -> 00
    }

    time = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    text = text.replace(t[0], ' ');
  }

  // Palabras especiales si no se dijo HH:MM
  if (!time && mer === 'noon')      time = '12:00';
  if (!time && mer === 'midnight')  time = '00:00';

  // Si hay franja y NO hay hora -> pon una hora por defecto
  if (!time && mer){
    if (mer === 'am')       time = '09:00';
    else if (mer === 'pm')  time = '16:00';
    else if (mer === 'night') time = '20:00';
    else if (mer === 'dawn')  time = '02:00';
  }

  // -------- Fecha --------
  const today = new Date(); today.setHours(0,0,0,0);

  // pasado mañana / mañana / hoy
  if (/\bpasado\s+mañana\b|\bpasado\s+manana\b/.test(text)) {
    const d = new Date(today); d.setDate(d.getDate()+2);
    date = d; text = text.replace(/\bpasado\s+mañana\b|\bpasado\s+manana\b/, ' ');
  } else if (/\bmañana\b|\bmanana\b/.test(text)) {
    const d = new Date(today); d.setDate(d.getDate()+1);
    date = d; text = text.replace(/\bmañana\b|\bmanana\b/, ' ');
  } else if (/\bhoy\b/.test(text)) {
    date = new Date(today); text = text.replace(/\bhoy\b/, ' ');
  }

  // 1) "10 de septiembre" (numérica)
  let m = text.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  // 2) "nueve de septiembre" (en palabras)
  const NUM_WORD = {
    'uno':1,'una':1,'dos':2,'tres':3,'cuatro':4,'cinco':5,'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,
    'once':11,'doce':12,'trece':13,'catorce':14,'quince':15,'dieciseis':16,'dieciséis':16,'diecisiete':17,'dieciocho':18,'diecinueve':19,
    'veinte':20,'veintiuno':21,'veintidos':22,'veintidós':22,'veintitres':23,'veintitrés':23,'veinticuatro':24,'veinticinco':25,
    'veintiseis':26,'veintiséis':26,'veintisiete':27,'veintiocho':28,'veintinueve':29,'treinta':30,'treinta y uno':31,'treintayuno':31
  };

  if (m) {
    const dd = Math.min(31, parseInt(m[1],10));
    const mm = MONTHS[m[2]];
    const y  = new Date().getFullYear();
    const d  = new Date(y, mm, dd);
    if (d < today) d.setFullYear(y+1);
    date = d; text = text.replace(m[0], ' ');
  } else {
    m = text.match(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintidós|veintitres|veintitrés|veinticuatro|veinticinco|veintiseis|veintiséis|veintisiete|veintiocho|veintinueve|treinta|treinta y uno|treintayuno)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
    if (m) {
      const dd = Math.min(31, NUM_WORD[m[1]]);
      const mm = MONTHS[m[2]];
      const y  = new Date().getFullYear();
      const d  = new Date(y, mm, dd);
      if (d < today) d.setFullYear(y+1);
      date = d; text = text.replace(m[0], ' ');
    }
  }

  // Limpieza final para el texto que mostramos/guardamos
  text = text.replace(/\s{2,}/g,' ').trim();

  return { date, time, cleaned: text };
}


  // Devuelve {type, text, date, time}
function parseIntent(transcript){
  const original = (transcript || '').trim();

  // 1) Detecta el comando al principio (nota/tarea/rutina/cita/compra/comprar/lista de la compra)
  const head = original.match(/^\s*(nota|tarea|rutina|cita|compra|comprar|lista(?:\s+de\s+la\s+compra)?)\b/i);
  let type = 'nota';
  let payloadOriginal = original;
  if (head){
    const key = head[1].toLowerCase();
    if (key === 'compra' || key === 'comprar' || key.startsWith('lista')) type = 'compra';
    else type = key; // nota / tarea / rutina / cita
    payloadOriginal = original.slice(head[0].length);
  }

  // 2) Para “compra” no necesitamos fecha/hora, pero usamos el limpiador para quitar restos
  if (type === 'compra'){
    const { cleaned } = parseDateTime(payloadOriginal);
    const text = (cleaned || payloadOriginal).replace(/\s{2,}/g,' ').trim();
    return { type, text, date:null, time:null };
  }

  // 3) El resto igual que antes
  const { date, time, cleaned } = parseDateTime(payloadOriginal);
  const text = (cleaned || payloadOriginal)
    .replace(/\b(el\s+d[ií]a)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { type, text, date, time };
}


  // ======== UI: modal y reconocimiento ========
  function createRec(){
    if (!SpeechRecognition) {
      liveBox.textContent = 'Tu navegador no soporta reconocimiento de voz (usa Chrome/Edge con HTTPS o localhost).';
      return null;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'es-ES';
    rec.interimResults = true;  // muestra texto parcial
    rec.continuous = true;      // no se para tras una frase
    rec.maxAlternatives = 1;    // evita saltos entre hipótesis
    return rec;
  }

  function openModal(){
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }
  function closeModal(){
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
  }

  function startListen(){
    if (!recognition) recognition = createRec();
    if (!recognition) return;

    keepListening = true; // seguimos escuchando aunque Chrome corte por silencio
    finalText = '';
    liveBox.textContent = 'Escuchando…';
    liveBox.classList.add('listening');
    micBtn?.classList.add('grabando');

    const flushOnSilence = () => {
      // Aquí podrías auto-enviar al iframe si quieres:
      // const t = liveBox.textContent.trim();
      // if (t) sendToIframe(parseIntent(t));
    };

    recognition.onresult = (e) => {
      let parcial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const frase = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + frase.trim();
        else parcial += ' ' + frase;
      }
      const total = (finalText + ' ' + parcial).replace(/\s+/g,' ').trim();
      liveBox.textContent = total; // transcripción en vivo

      // Preview rápido en el title
      const intent = parseIntent(total);
      liveBox.title = `Tipo: ${intent.type.toUpperCase()} · ${intent.text || ''} ${intent.date ? '· ' + intent.date.toLocaleDateString() : ''} ${intent.time ? '· ' + intent.time : ''}`.trim();

      // Reinicia el temporizador de silencio
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(flushOnSilence, SILENCE_MS);
    };

    recognition.onerror = (e) => console.error('Speech error:', e);

    // Chrome corta al detectar silencio: re-arrancar si el modal sigue abierto
    recognition.onend = () => {
      if (keepListening && modal.classList.contains('show')) {
        try { recognition.start(); } catch {}
      } else {
        escuchando = false;
        liveBox.classList.remove('listening');
        micBtn?.classList.remove('grabando');
      }
    };

    try { recognition.start(); } catch {}
    escuchando = true;
  }

  function stopListen(){
    keepListening = false;
    clearTimeout(silenceTimer);
    if (recognition) recognition.stop();
  }

  // ======== Envío al iframe (postMessage) ========
  function sendToIframe(intent){
    const { type, text, date, time } = intent;
    if (!text) return;

    const win = frame?.contentWindow;
    if (!win){
      console.warn('No encuentro el iframe #app-frame');
      return;
    }
    win.postMessage({
      action: 'voice-create',
      payload: {
        type,
        text,
        date: date ? date.toISOString() : null,
        time: time || null
      }
    }, '*');
    console.log('[microfono] voice-create enviado al iframe:', intent);
  }

  // ======== Pegar en input dentro del iframe (si lo usas) ========
  function pasteIntoApp(text){
    try{
      const doc = frame?.contentWindow?.document;
      if (!doc) return false;

      const active = doc.activeElement;
      const isTextField = (el) =>
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

      let target = isTextField(active) ? active : doc.querySelector('input[type="text"], textarea, [contenteditable="true"]');
      if (!target) return false;

      if (target.isContentEditable) {
        target.focus();
        document.execCommand('insertText', false, text);
      } else {
        const start = target.selectionStart ?? target.value.length;
        const end   = target.selectionEnd   ?? target.value.length;
        const prev  = target.value ?? '';
        target.value = prev.slice(0,start) + text + prev.slice(end);
        target.dispatchEvent(new Event('input', {bubbles:true}));
        target.focus();
        target.selectionStart = target.selectionEnd = start + text.length;
      }
      return true;
    } catch(e){
      console.warn('No se pudo pegar en el iframe:', e);
      return false;
    }
  }

  // ======== Eventos UI ========
  micBtn?.addEventListener('click', () => {
    openModal();
    if (!escuchando) startListen(); else stopListen();
  });

  btnClose?.addEventListener('click', () => { stopListen(); closeModal(); });
  modal?.addEventListener('click', (e)=>{ if (e.target === modal){ stopListen(); closeModal(); } });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape'){ stopListen(); closeModal(); } });

  btnCopy?.addEventListener('click', async () => {
    const t = liveBox.textContent.trim();
    if (!t) return;
    try { await navigator.clipboard.writeText(t); btnCopy.textContent = 'Copiado ✓'; setTimeout(()=>btnCopy.textContent='Copiar',1200); }
    catch { btnCopy.textContent = 'No se pudo copiar'; setTimeout(()=>btnCopy.textContent='Copiar',1800); }
  });

  btnPaste?.addEventListener('click', () => {
    const t = liveBox.textContent.trim();
    if (!t) return;
    const ok = pasteIntoApp(t);
    btnPaste.textContent = ok ? 'Pegado ✓' : 'No se pudo pegar';
    setTimeout(()=>btnPaste.textContent='Pegar en la app', 1400);
  });

  // >>> Crear según comando: ENVÍA AL IFRAME <<<
  btnCreate?.addEventListener('click', () => {
    const t = liveBox.textContent.trim();
    if (!t) return;
    const intent = parseIntent(t);
    sendToIframe(intent);
    btnCreate.textContent = 'Enviado ✓';
    setTimeout(()=>btnCreate.textContent='Crear según comando', 1200);
  });

  // Si quieres auto-enviar al terminar la frase, descomenta en flushOnSilence() de arriba.
})();
