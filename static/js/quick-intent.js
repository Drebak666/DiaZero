// quick-intent.js — Captura rápida por voz (es-ES) → Nombre + Teléfono
// Requiere: navegador con Web Speech API (Chrome/Edge/Android). Fallback: alerta.

(function(){
  const btn = document.getElementById('quick-mic-btn');
  const panel = document.getElementById('quick-mic-panel');
  const closeBtn = document.getElementById('qmp-close');
  const nameInp = document.getElementById('qmp-name');
  const phoneInp = document.getElementById('qmp-phone');
  const saveBtn = document.getElementById('qmp-save-note');
  const copyBtn = document.getElementById('qmp-copy');
  const statusEl = document.getElementById('qmp-status');

  if(!btn || !panel) return;

  // ======== Utilidades ========
  const DIG = {
    'cero':'0','0':'0',
    'uno':'1','una':'1','1':'1',
    'dos':'2','2':'2',
    'tres':'3','3':'3',
    'cuatro':'4','4':'4',
    'cinco':'5','5':'5',
    'seis':'6','6':'6',
    'siete':'7','7':'7',
    'ocho':'8','8':'8',
    'nueve':'9','9':'9'
  };
  const FILLER = new Set(['mi','me','es','soy','de','del','la','el','para','con','y','por','porfavor','porfavor,','porfa','porfa,','apunta','apúntalo','apuntar','apúntame','toma','telefono','teléfono','movil','móvil','celular']);

  function norm(s){ return (s||'').toLowerCase()
    .replace(/[.,;:!?()]/g,' ')
    .replace(/\s+/g,' ')
    .trim(); }

  // Convierte “doble tres” → “33”, “triple cinco” → “555”, maneja “guión”, “espacio”, “más” → “+”
  function tokensToDigits(tokens){
    let out = '';
    let i=0;
    while(i<tokens.length){
      const t = tokens[i];
      const tnext = tokens[i+1] || '';
      if((t==='doble' || t==='double') && DIG[tnext]){ out += DIG[tnext] + DIG[tnext]; i+=2; continue; }
      if((t==='triple') && DIG[tnext]){ out += DIG[tnext] + DIG[tnext] + DIG[tnext]; i+=2; continue; }
      if(t==='guion' || t==='guión' || t==='barra' || t==='espacio'){ out += ''; i++; continue; }
      if(t==='mas' || t==='más'){ out += '+'; i++; continue; }
      if(t==='cero' && (tokens[i+1]==='o' || tokens[i+1]==='ó')){ out += '0'; i+=2; continue; } // por si dice "cero o ..."
      if(DIG[t]){ out += DIG[t]; i++; continue; }
      // números ya reconocidos (e.g., "655")
      if(/^[+\d]+$/.test(t)){ out += t.replace(/\D/g,''); i++; continue; }
      i++;
    }
    // formateo sueltecito: +34600123456 → +34 600 123 456
    out = out.replace(/[^\d+]/g,'');
    if(out.startsWith('+34') && out.length>=12){
      const raw = out.replace('+34','');
      out = '+34 ' + raw.slice(0,3) + ' ' + raw.slice(3,6) + ' ' + raw.slice(6,9) + (raw.slice(9)?(' '+raw.slice(9)):'');
    } else if(out.length>=9){
      out = out.slice(0,3)+' '+out.slice(3,6)+' '+out.slice(6,9) + (out.slice(9)?(' '+out.slice(9)):'');
    }
    return out.trim();
  }

  // Saca nombre aproximado de frases típicas
  function extractName(tokens){
    const idxSoy = tokens.indexOf('soy');
    const idxLlamo = tokens.indexOf('llamo'); // "me llamo"
    const idxSeLlama = tokens.indexOf('llama'); // "se llama"
    let name = '';
    const grab = (start) => {
      const take = [];
      for(let i=start;i<tokens.length;i++){
        const t=tokens[i];
        if(FILLER.has(t)) continue;
        if(/^[+\d]+$/.test(t) || DIG[t]) break; // empieza el teléfono
        take.push(t[0].toUpperCase()+t.slice(1));
        if(t.endsWith(',')) break;
      }
      return take.join(' ').trim();
    };
    if(idxSoy>=0) name = grab(idxSoy+1);
    if(!name && idxLlamo>0 && tokens[idxLlamo-1]==='me') name = grab(idxLlamo+1);
    if(!name && idxSeLlama>0 && tokens[idxSeLlama-1]==='se') name = grab(idxSeLlama+1);
    return name;
  }

  function parseTranscript(text){
    const t = norm(text);
    const rawTokens = t.split(' ').filter(Boolean);
    const tokens = rawTokens.map(x => x.normalize('NFD').replace(/[\u0300-\u036f]/g,'')); // sin acentos
    const name = extractName(tokens);
    const phone = tokensToDigits(tokens);
    return { name, phone, raw: text };
  }

  function showPanel(){ panel.hidden = false; }
  function hidePanel(){ panel.hidden = true; status(''); }
  function status(msg){ statusEl.textContent = msg||''; }

  // ======== Guardado como Nota (ajusta a tu tabla) ========
  async function saveToNotes(){
    try{
      if(!window.supabase){ alert('Supabase no cargado'); return; }
      const usuario = localStorage.getItem('usuario_actual') || 'anon';
      const descripcion = `Tel ${nameInp.value || '(sin nombre)'}: ${phoneInp.value || '(sin teléfono)'}`;
      const { error } = await supabase.from('notas').insert([{ usuario, descripcion }]);
      if(error){ console.error(error); alert('No pude guardar la nota'); return; }
      status('✅ Guardado en Notas');
    }catch(e){ console.error(e); alert('Error inesperado'); }
  }

  // ======== Mic & reconocimiento ========
  let rec=null, listening=false;

  function ensureRecognizer(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r = new SR();
    r.lang = 'es-ES';
    r.interimResults = true;
    r.continuous = false;
    return r;
  }

  function start(){
    if(listening) return;
    rec = ensureRecognizer();
    if(!rec){ alert('Tu navegador no soporta reconocimiento de voz.'); return; }
    listening = true;
    btn.classList.add('listening');
    status('🎙️ Escuchando… di: “Me llamo Ana… seis cinco cinco… doble tres…”');

    let finalText='';
    rec.onresult = (e)=>{
      let txt='';
      for(let i=e.resultIndex;i<e.results.length;i++){
        txt += e.results[i][0].transcript + ' ';
        if(e.results[i].isFinal) finalText = txt;
      }
      const {name, phone} = parseTranscript(txt || finalText);
      if(name) nameInp.value = name;
      if(phone) phoneInp.value = phone;
      showPanel();
    };
    rec.onerror = (e)=>{ status('⚠️ '+(e.error||'Error de mic')); stop(); };
    rec.onend = ()=>{ stop(); };
    try{ rec.start(); }catch{}
  }

  function stop(){
    if(!listening) return;
    listening=false;
    btn.classList.remove('listening');
    try{ rec && rec.stop(); }catch{}
  }

  // ======== Eventos UI ========
  btn.addEventListener('click', ()=>{ if(listening) stop(); else start(); });
  closeBtn.addEventListener('click', ()=> hidePanel());
  saveBtn.addEventListener('click', ()=> saveToNotes());
  copyBtn.addEventListener('click', async ()=>{
    const txt = `${nameInp.value} — ${phoneInp.value}`;
    try{ await navigator.clipboard.writeText(txt); status('📋 Copiado'); }catch{ status('No se pudo copiar'); }
  });
})();
