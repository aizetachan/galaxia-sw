// === Config ===
const DEFAULT_API_BASE = 'http://localhost:3001';
const API_BASE =
  (typeof window !== 'undefined' && window.API_BASE) ||
  DEFAULT_API_BASE;

// === Helpers de URL (evita redirecciones por slash)
function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/,'');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

// === State ===
let AUTH = { token: null, user: null };
const baseKey = (suffix) => (AUTH?.user?.id ? `sw:${AUTH.user.id}:${suffix}` : `sw:guest:${suffix}`);
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

// Listeners
sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
resolveBtn.addEventListener('click', resolveRoll);
authLoginBtn.addEventListener('click', () => doAuth('login'));
authRegisterBtn.addEventListener('click', () => doAuth('register'));
cancelBtn.addEventListener('click', () => { pendingRoll = null; updateRollCta(); });

// === Boot ===
(async function boot() {
  try {
    const saved = JSON.parse(localStorage.getItem('sw:auth') || 'null');
    if (saved?.token && saved?.user?.id) {
      AUTH = saved;
      await apiGet('/auth/me').catch(async (e) => {
        if (e.response?.status === 401) throw new Error('UNAUTHORIZED');
        throw e;
      });
      KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step');
      msgs = load(KEY_MSGS, []);
      character = load(KEY_CHAR, null);
      step = load(KEY_STEP, 'name');
      authStatusEl.textContent = `Hola, ${saved.user.username}`;
    } else {
      AUTH = null;
      localStorage.removeItem('sw:auth');
      KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step');
      msgs = load(KEY_MSGS, []);
      character = load(KEY_CHAR, null);
      step = load(KEY_STEP, 'name');
    }
  } catch {
    authStatusEl.textContent = 'Sin conexión para validar sesión';
  }

  if (!msgs.length) {
    pushDM(`Bienvenid@ al **HoloCanal**. Aquí jugamos una historia viva de Star Wars.
Para empezar, inicia sesión (usuario + PIN). Luego crearemos tu identidad y entramos en escena.`);
  }
  render();
})();

// === Utils ===
function load(k, fb) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function now() { return Date.now(); }
function hhmm(ts) { return new Date(ts).toLocaleTimeString(); }

function emit(m) { msgs = [...msgs, m]; save(KEY_MSGS, msgs); render(); }
function pushDM(text) { emit({ user: 'Máster', text, kind: 'dm', ts: now() }); }
function pushUser(text) { emit({ user: character?.name || 'Tú', text, kind: 'user', ts: now() }); }

// Clasificador sencillo para sugerir tirada (solo UI, el LLM lo comenta en su única respuesta)
function classifyIntent(text) {
  const t = (text || '').trim().toLowerCase();
  const defStarts = /^(mi personaje|soy|me llamo|me pongo|llevo|tengo|defino|declaro|establezco|asumo|recuerdo|configuro)\b/;
  const defPossessive = /\bmi(s)?\b/;
  if (defStarts.test(t)) return { required: false, reason: 'def' };
  if (defPossessive.test(t) && !/(empujo|abro|forzar|ataco|disparo|persuad|convenc|hackeo|reprogramo|piloto|escapo|esquivo|trepo|salto|investigo|busco|percibo|me escondo|oculto|sabot|burlar)/.test(t))
    return { required: false, reason: 'def' };

  const maps = [
    { re: /(ataco|golpeo|disparo|apunto|lanzo|asalto)/, skill: 'Combate' },
    { re: /(sigilo|me escondo|oculto|agazapo|camuflo)/, skill: 'Sigilo' },
    { re: /(forzar|romper|empujar|abrir|derribar)/, skill: 'Fuerza' },
    { re: /(persuad|convenc|negoci|intimid|engañ)/, skill: 'Carisma' },
    { re: /(percib|observo|escucho|rastro|vigilo|escaneo)/, skill: 'Percepción' },
    { re: /(investig|busco pistas|rebusco|analizo|rastre)/, skill: 'Investigación' },
    { re: /(saltar|trepar|acrob|equilibro|esquivo|carrera)/, skill: 'Movimiento' },
    { re: /(robo|hurto|manos\s?rapidas|desarmo|desactivar trampa|saco)/, skill: 'Juego de manos' },
    { re: /(hackeo|sliceo|reprogramo|pirateo)/, skill: 'Tecnología' },
    { re: /(piloto|despego|aterrizo|hipersalto|burlar escudos)/, skill: 'Pilotaje' },
  ];
  for (const m of maps) if (m.re.test(t)) return { required: true, skill: m.skill };
  if (/(intento|quiero|trato de|procuro|busco)/.test(t)) return { required: true, skill: 'Acción incierta' };
  return { required: false, reason: 'talk' };
}

// ---- Fetch helpers
async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH?.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = res;
    throw err;
  }
  return res.json();
}
async function apiGet(path) {
  const headers = {};
  if (AUTH?.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = res;
    throw err;
  }
  return res.json();
}

function render() {
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
function formatMarkdown(t = '') {
  return t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}
function updatePlaceholder() {
  const placeholders = {
    name: 'Tu nombre en el HoloNet…',
    species: 'Elige especie (Humano, Twi\'lek, Wookiee, Zabrak, Droide)…',
    role: 'Elige rol (Piloto, Contrabandista, Jedi, Cazarrecompensas, Ingeniero)…',
    done: 'Escribe tu acción o pregunta…'
  };
  inputEl.placeholder = placeholders[step] || placeholders.done;
}
function updateRollCta() {
  if (pendingRoll) {
    rollCta.classList.remove('hidden');
    rollSkillEl.textContent = pendingRoll.skill ? ` · ${pendingRoll.skill}` : '';
  } else {
    rollCta.classList.add('hidden');
  }
}

// --- Helper: detectar etiqueta de tirada en el texto del Máster ---
function parseRollTag(txt = '') {
  // Acepta: <<ROLL SKILL="Combate" REASON="lo que sea">>
  const re = /<<\s*ROLL\b(?:\s+SKILL\s*=\s*"([^"]*)")?(?:\s+REASON\s*=\s*"([^"]*)")?\s*>>/i;
  const m = re.exec(txt);
  if (!m) return null;
  const skill = (m[1] || 'Acción').trim();
  const reason = (m[2] || '').trim();
  const cleaned = txt.replace(re, '').trim();
  return { skill, reason, cleaned };
}

// === Hablar con el Máster (LLM) — UNA SOLA RESPUESTA ===
async function talkToDM(message, intent) {
  try {
    const history = msgs.slice(-8);
    const res = await api('/dm/respond', {
      message,
      history,
      character,
      stage: step,
      intentRequired: !!intent?.required
    });

    let txt = res.text || 'El neón chisporrotea sobre la barra. ¿Qué haces?';

    // NUEVO: si el Máster pide tirada mediante etiqueta, activamos CTA y limpiamos el texto
    const roll = parseRollTag(txt);
    if (roll) {
      pendingRoll = { skill: roll.skill };
      updateRollCta();
      txt = roll.cleaned || `Necesitamos una tirada para **${roll.skill}**. Pulsa “Resolver tirada”.`;
    }

    pushDM(txt);
  } catch {
    // Un único fallback si falla la llamada al modelo
    pushDM('El canal se llena de estática. Intenta de nuevo en un momento.');
  }
}

// === Send flow ===
async function send() {
  const value = inputEl.value.trim(); if (!value) return;

  // Comandos rápidos
  if ((value === '/privado' || value === '/publico') && character) {
    character.publicProfile = (value === '/publico');
    save(KEY_CHAR, character);
    try { await api('/world/characters', { character }); } catch {}
    // No añadimos otra respuesta; el LLM puede comentarlo en su turno siguiente si preguntas
    inputEl.value = ''; return;
  }

  if (value === '/restart') {
    localStorage.removeItem(KEY_MSGS);
    localStorage.removeItem(KEY_CHAR);
    localStorage.removeItem(KEY_STEP);
    msgs = []; character = null; step = 'name'; pendingRoll = null;
    pushDM(`Bienvenid@ al **HoloCanal**. Soy tu **Máster**. Vamos a registrar tu identidad para entrar en la galaxia.\n\nPrimero: ¿cómo te llamas en la red del HoloNet?`);
    inputEl.value = ''; return;
  }

  // Emitimos lo que escribe el jugador
  pushUser(value);
  const intent = classifyIntent(value);

  // Onboarding NO bloqueante: actualiza estado, pero NO emite mensajes extra.
  if (step !== 'done') {
    if (step === 'name') {
      const name = value || 'Aventurer@';
      character = { name, species: '', role: '', publicProfile: true, lastLocation: 'Tatooine — Cantina de Mos Eisley' };
      save(KEY_CHAR, character);
      try { await api('/world/characters', { character }); } catch {}
      step = 'species'; save(KEY_STEP, step);
    } else if (step === 'species') {
      const map = { humano: 'Humano', twi: "Twi'lek", wook: 'Wookiee', zabr: 'Zabrak', droid: 'Droide', droide: 'Droide' };
      const key = Object.keys(map).find(k => value.toLowerCase().startsWith(k));
      if (key) {
        character.species = map[key];
        save(KEY_CHAR, character);
        try { await api('/world/characters', { character }); } catch {}
        step = 'role'; save(KEY_STEP, step);
      }
    } else if (step === 'role') {
      const map = { pilo: 'Piloto', piloto: 'Piloto', contra: 'Contrabandista', jedi: 'Jedi', caza: 'Cazarrecompensas', inge: 'Ingeniero', ingeniero: 'Ingeniero' };
      const key = Object.keys(map).find(k => value.toLowerCase().startsWith(k));
      if (key) {
        character.role = map[key];
        save(KEY_CHAR, character);
        try { await api('/world/characters', { character }); } catch {}
        step = 'done'; save(KEY_STEP, step);
      }
    }
    // Siempre UNA respuesta del Máster
    await talkToDM(value, intent);
    inputEl.value = '';
    return;
  }

  // Juego normal: si el cliente detecta acción incierta, muestra CTA (además de lo que pida el Máster)
  if (intent.required) {
    pendingRoll = { skill: intent.skill };
    updateRollCta();
  }

  await talkToDM(value, intent);
  inputEl.value = '';
}

let busy = false;
async function resolveRoll() {
  if (!pendingRoll || busy) return;
  busy = true;
  try {
    const res = await api('/roll', { skill: pendingRoll.skill, character });
    pushDM(res.text);
  } catch {
    pushDM('Algo se interpone; la situación se complica.');
  } finally {
    busy = false;
    pendingRoll = null;
    render();
  }
}

// Migración guest → user (opcional)
function migrateGuestToUser(userId) {
  const load = (k) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } };
  const gMsgs = load('sw:guest:msgs');
  const gChar = load('sw:guest:char');
  const gStep = load('sw:guest:step');
  const kMsgs = `sw:${userId}:msgs`;
  const kChar = `sw:${userId}:char`;
  const kStep = `sw:${userId}:step`;
  if (gMsgs && !localStorage.getItem(kMsgs)) localStorage.setItem(kMsgs, JSON.stringify(gMsgs));
  if (gChar && !localStorage.getItem(kChar)) localStorage.setItem(kChar, JSON.stringify(gChar));
  if (gStep && !localStorage.getItem(kStep)) localStorage.setItem(kStep, JSON.stringify(gStep));
  localStorage.removeItem('sw:guest:msgs');
  localStorage.removeItem('sw:guest:char');
  localStorage.removeItem('sw:guest:step');
}

async function doAuth(kind) {
  const username = (authUserEl.value || '').trim();
  const pin = (authPinEl.value || '').trim();
  if (!username || !/^\d{4}$/.test(pin)) { authStatusEl.textContent = 'Usuario y PIN (4 dígitos)'; return; }
  try {
    const url = kind === 'register' ? '/auth/register' : '/auth/login';
    const { token, user } = (await api(url, { username, pin }));
    AUTH = { token, user };
    localStorage.setItem('sw:auth', JSON.stringify(AUTH));

    KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step');
    msgs = load(KEY_MSGS, []);
    character = load(KEY_CHAR, null);
    step = load(KEY_STEP, 'name');

    const me = await apiGet('/world/characters/me');
    if (me?.character) { character = me.character; save(KEY_CHAR, character); }

    authStatusEl.textContent = `Hola, ${user.username}`;
    if (character?.name && step !== 'done') {
      step = 'done'; save(KEY_STEP, step);
      pushDM(`Salud de nuevo, **${character.name}**. Retomamos en **${character.lastLocation || 'la cantina'}**.`);
    }
    render();
  } catch (e) {
    try {
      const data = await e.response?.json?.();
      const code = data?.error;
      const friendly = {
        INVALID_CREDENTIALS: 'Usuario (3–24 minúsculas/números/_) y PIN de 4 dígitos.',
        USERNAME_TAKEN: 'Ese usuario ya existe.',
        USER_NOT_FOUND: 'Usuario no encontrado.',
        INVALID_PIN: 'PIN incorrecto.',
        unauthorized: 'No autorizado.',
      };
      authStatusEl.textContent = (code && (friendly[code] || code)) || 'Error de autenticación';
    } catch {
      authStatusEl.textContent = 'Error de autenticación';
    }
  }
}

function extractTargetName(text) {
  const t = (text || '').trim();
  let m = t.match(/^(?:pregunto|preguntar|preguntas|averiguar|buscar)\s+por\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,})/i);
  if (m) return m[1].trim();
  m = t.match(/^\/whois\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,})/i);
  if (m) return m[1].trim();
  m = t.match(/(?:sobre|de)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,})\s*(?:dónde|quién|qué)?\??$/i);
  if (m) return m[1].trim();
  return null;
}
