// === Config ===
const API_BASE = 'http://localhost:3001';

// === State ===
let AUTH = { token: null, user: null };
const baseKey = (suffix) => AUTH?.user?.id ? `sw:${AUTH.user.id}:${suffix}` : `sw:guest:${suffix}`;
let KEY_MSGS = baseKey('msgs');
let KEY_CHAR = baseKey('char');
let KEY_STEP = baseKey('step');
let msgs = load(KEY_MSGS, []);
let character = load(KEY_CHAR, null);
let step = load(KEY_STEP, 'name');
let pendingRoll = null;

// === DOM ===
const chatEl = document.getElementById('chat');
const authUserEl = document.getElementById('auth-username');
const authPinEl = document.getElementById('auth-pin');
const authLoginBtn = document.getElementById('auth-login');
const authRegisterBtn = document.getElementById('auth-register');
const authStatusEl = document.getElementById('auth-status');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const rollCta = document.getElementById('roll-cta');
const rollSkillEl = document.getElementById('roll-skill');
const resolveBtn = document.getElementById('resolve-btn');
const cancelBtn = document.getElementById('cancel-btn');

// Init
try { AUTH = JSON.parse(localStorage.getItem('sw:auth')||'null') || null; } catch {}
if (AUTH?.user?.id){ KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step'); }
if (!msgs.length) pushDM(`Bienvenid@ al **HoloCanal**. Primero inicia sesión (usuario + PIN) y luego crearemos tu personaje.`);
render();

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') send(); });
resolveBtn.addEventListener('click', resolveRoll);

// Auth events
authLoginBtn.addEventListener('click', () => doAuth('login'));
authRegisterBtn.addEventListener('click', () => doAuth('register'));
cancelBtn.addEventListener('click', ()=> { pendingRoll = null; updateRollCta(); });

// === Utils ===
function load(k, fb){ try{ const r=localStorage.getItem(k); return r? JSON.parse(r): fb; }catch{ return fb; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function now(){ return Date.now(); }
function hhmm(ts){ return new Date(ts).toLocaleTimeString(); }

function emit(m){ msgs = [...msgs, m]; save(KEY_MSGS, msgs); render(); }
function pushDM(text){ emit({ user:'Máster', text, kind:'dm', ts: now() }); }
function pushUser(text){ emit({ user:character?.name || 'Tú', text, kind:'user', ts: now() }); }

function classifyIntent(text){
  const t = (text||'').trim().toLowerCase();
  const defStarts = /^(mi personaje|soy|me llamo|me pongo|llevo|tengo|defino|declaro|establezco|asumo|recuerdo|configuro)\b/;
  const defPossessive = /\bmi(s)?\b/;
  if (defStarts.test(t)) return { required:false, reason:'def' };
  if (defPossessive.test(t) && !/(empujo|abro|forzar|ataco|disparo|persuad|convenc|hackeo|reprogramo|piloto|escapo|esquivo|trepo|salto|investigo|busco|percibo|me escondo|oculto|sabot|burlar)/.test(t)) return { required:false, reason:'def' };

  const maps = [
    { re:/(ataco|golpeo|disparo|apunto|lanzo|asalto)/, skill:'Combate' },
    { re:/(sigilo|me escondo|oculto|agazapo|camuflo)/, skill:'Sigilo' },
    { re:/(forzar|romper|empujar|abrir|derribar)/,     skill:'Fuerza' },
    { re:/(persuad|convenc|negoci|intimid|engañ)/,     skill:'Carisma' },
    { re:/(percib|observo|escucho|rastro|vigilo|escaneo)/, skill:'Percepción' },
    { re:/(investig|busco pistas|rebusco|analizo|rastre)/, skill:'Investigación' },
    { re:/(saltar|trepar|acrob|equilibro|esquivo|carrera)/, skill:'Movimiento' },
    { re:/(robo|hurto|manos\s?rapidas|desarmo|desactivar trampa|saco)/, skill:'Juego de manos' },
    { re:/(hackeo|sliceo|reprogramo|pirateo)/,         skill:'Tecnología' },
    { re:/(piloto|despego|aterrizo|hipersalto|burlar escudos)/, skill:'Pilotaje' },
  ];
  for (const m of maps) if (m.re.test(t)) return { required:true, skill:m.skill };
  if (/(intento|quiero|trato de|procuro|busco)/.test(t)) return { required:true, skill:'Acción incierta' };
  return { required:false, reason:'talk' };
}

async function api(path, body){
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH?.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const res = await fetch(`${API_BASE}${path}`, { method:'POST', headers, body: JSON.stringify(body||{}) });
  if (!res.ok) throw new Error('api error');
  return res.json();
}

function render(){
  chatEl.innerHTML = msgs.map(m => `
    <div class="msg ${m.kind}">
      <div class="meta">[${hhmm(m.ts)}] ${m.user}:</div>
      <div class="text">${formatMarkdown(m.text)}</div>
    </div>
  `).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
  updatePlaceholder();
  updateRollCta();
}

function formatMarkdown(t=''){
  return t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g,'<br>');
}

function updatePlaceholder(){
  const placeholders = {
    name: 'Tu nombre en el HoloNet…',
    species: 'Elige especie (Humano, Twi\'lek, Wookiee, Zabrak, Droide)…',
    role: 'Elige rol (Piloto, Contrabandista, Jedi, Cazarrecompensas, Ingeniero)…',
    done: 'Escribe tu acción o pregunta…'
  };
  inputEl.placeholder = placeholders[step] || placeholders.done;
}

function updateRollCta(){
  if (pendingRoll){
    rollCta.classList.remove('hidden');
    rollSkillEl.textContent = pendingRoll.skill ? ` · ${pendingRoll.skill}` : '';
  } else {
    rollCta.classList.add('hidden');
  }
}

// === Send flow ===
async function send(){
  const value = inputEl.value.trim(); if (!value) return;

  // Privacy commands
  if ((value === '/privado' || value === '/publico') && character) {
    character.publicProfile = (value === '/publico');
    save(KEY_CHAR, character);
    try { await api('/api/world/characters', { character }); } catch{}
    pushDM(`Tu perfil ahora es **${character.publicProfile ? 'público' : 'privado'}** en el HoloNet.`);
    inputEl.value = ''; return;
  }

  if (value === '/restart'){
    localStorage.removeItem(KEY_MSGS);
    localStorage.removeItem(KEY_CHAR);
    localStorage.removeItem(KEY_STEP);
    msgs = []; character = null; step = 'name'; pendingRoll = null;
    pushDM(`Bienvenid@ al **HoloCanal**. Soy tu **Máster**. Vamos a registrar tu identidad para entrar en la galaxia.\n\nPrimero: ¿cómo te llamas en la red del HoloNet?`);
    inputEl.value = ''; return;
  }

  if (step !== 'done'){
    emit({ user:'Tú', text:value, kind:'user', ts: now() });
    if (step === 'name'){
      const name = value || 'Aventurer@';
      character = { name, species:'', role:'', publicProfile:true, lastLocation:'Tatooine — Cantina de Mos Eisley' };
      save(KEY_CHAR, character);
      try { await api('/api/world/characters', { character }); } catch{}
      pushDM(`Entendido, **${name}**. Indica tu **especie** (escribe una): Humano, Twi'lek, Wookiee, Zabrak o Droide.`);
      step = 'species'; save(KEY_STEP, step);
    } else if (step === 'species'){
      const options = ["humano","twi","wook","zabr","droid","droide"];
      const ok = options.some(prefix => value.toLowerCase().startsWith(prefix));
      if (!ok){ pushDM(`No te he entendido. Especies válidas: Humano, Twi'lek, Wookiee, Zabrak, Droide.`); inputEl.value=''; return; }
      const map = { humano:"Humano","twi":"Twi'lek","wook":"Wookiee","zabr":"Zabrak","droid":"Droide","droide":"Droide" };
      for (const k in map){ if (value.toLowerCase().startsWith(k)){ character.species = map[k]; break; } }
      save(KEY_CHAR, character);
      try { await api('/api/world/characters', { character }); } catch{}
      pushDM(`Perfecto, ${character.name} (${character.species}). Ahora dime tu **rol**: Piloto, Contrabandista, Jedi, Cazarrecompensas o Ingeniero.`);
      step = 'role'; save(KEY_STEP, step);
    } else if (step === 'role'){
      const roles = ["piloto","contra","jedi","caza","inge"];
      const ok = roles.some(prefix => value.toLowerCase().startsWith(prefix));
      if (!ok){ pushDM(`Elige un rol válido: Piloto, Contrabandista, Jedi, Cazarrecompensas, Ingeniero.`); inputEl.value=''; return; }
      const map = { "pilo":"Piloto","contra":"Contrabandista","jedi":"Jedi","caza":"Cazarrecompensas","inge":"Ingeniero" };
      for (const k in map){ if (value.toLowerCase().startsWith(k)){ character.role = map[k]; break; } }
      save(KEY_CHAR, character);
      try { await api('/api/world/characters', { character }); } catch{}
      pushDM(`Registro completo. Eres **${character.name}**, ${character.species} ${character.role}. Ubicación inicial: **${character.lastLocation}**.\n\nRegla simple: **si decides algo sobre tu personaje, no hay tirada**. Si depende del mundo, te pediré que pulses **Resolver tirada**. ¿Qué haces?`);
      step = 'done'; save(KEY_STEP, step);
    }
    inputEl.value = ''; return;
  }

  // Conversación normal
  pushUser(value);
  const intent = classifyIntent(value);
  if (intent.required){
    pendingRoll = { skill: intent.skill };
    pushDM(`Esto no depende solo de ti. Pulsa **Resolver tirada${intent.skill ? ` para ${intent.skill}` : ''}** cuando quieras.`);
    inputEl.value = ''; render(); return;
  }

  try {
    const history = msgs.slice(-8);
    const target = extractTargetName(value);
    if (target){
      const resQ = await api('/api/world/ask-about', { targetName: target });
      pushDM(resQ.text || '...');
    } else {
      const res = await api('/api/dm/respond', { message:value, history, character });
      pushDM(res.text || '...');
    }
  } catch {
    pushDM('El neón de la cantina parpadea... ¿Observas, preguntas o te mueves?');
  }
  inputEl.value = '';
}

// === Roll resolution ===
let busy = false;
async function resolveRoll(){
  if (!pendingRoll || busy) return;
  busy = true;  # oops will cause error; fix to 'true'
}
  try{
    const res = await api('/api/roll', { skill: pendingRoll.skill, character });
    pushDM(res.text);
  }catch{
    pushDM('Algo se interpone; la situación se complica.');
  }finally{
    busy = false;
    pendingRoll = null;
    render();
  }
}

async function apiGet(path){
  const headers = {};
  if (AUTH?.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const res = await fetch(`${API_BASE}${path}`, { method:'GET', headers });
  if (!res.ok) throw new Error('api error');
  return res.json();
}

async function doAuth(kind){
  const username = (authUserEl.value || '').trim();
  const pin = (authPinEl.value || '').trim();
  if (!username || !/^\d{4}$/.test(pin)) { authStatusEl.textContent = 'Usuario y PIN (4 dígitos)'; return; }
  try{
    const url = kind === 'register' ? '/api/auth/register' : '/api/auth/login';
    const { token, user } = (await api(url, { username, pin }));
    AUTH = { token, user };
    localStorage.setItem('sw:auth', JSON.stringify(AUTH));
    // Recompute keys per user
    KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step');
    // Intentar cargar personaje del servidor
    const me = await apiGet('/api/world/characters/me');
    if (me?.character) {
      save(KEY_CHAR, me.character);
    }
    // Recarga chat local del usuario
    msgs = load(KEY_MSGS, []);
    character = load(KEY_CHAR, null);
    step = load(KEY_STEP, 'name');
    authStatusEl.textContent = `Hola, ${user.username}`;
    render();
  }catch(e){
    authStatusEl.textContent = 'Error de autenticación';
  }
}

function extractTargetName(text){
  const t = (text||'').trim();
  let m = t.match(/^(?:pregunto|preguntar|preguntas|averiguar|buscar)\s+por\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,})/i);
  if (m) return m[1].trim();
  m = t.match(/^\/whois\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,})/i);
  if (m) return m[1].trim();
  m = t.match(/(?:sobre|de)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,})\s*(?:dónde|quién|qué)?\??$/i);
  if (m) return m[1].trim();
  return null;
}
