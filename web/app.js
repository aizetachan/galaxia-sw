// === DEBUG helpers ===
const DEBUG = true;
function dlog(...a) { if (DEBUG) console.log('[WEB]', ...a); }
function dgroup(label, fn) {
  if (!DEBUG) return fn?.();
  console.groupCollapsed(label);
  try { fn?.(); } finally { console.groupEnd(); }
}

// ============================================================
//               Config API (robusta, sin <meta>)
// ============================================================
const API_STORE_KEY = 'sw:api_base';
const DEFAULT_API_BASE = 'https://galaxia-sw.vercel.app/api'; // <- cámbialo si tu API vive en otro host

function getMeta(name) {
  try { return document.querySelector(`meta[name="${name}"]`)?.content || ''; } catch { return ''; }
}
function getQuery(name) {
  try {
    const u = new URL(location.href);
    return u.searchParams.get(name) || '';
  } catch {
    return '';
  }
}
function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/,'');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

// Valor inicial (se sobreescribe en ensureApiBase)
let API_BASE =
  (typeof window !== 'undefined' && window.API_BASE) ||
  getMeta('api-base') ||
  (typeof location !== 'undefined' ? (location.origin + '/api') : '') ||
  DEFAULT_API_BASE;

function setServerStatus(ok, msg) {
  const el = document.getElementById('server-status');
  if (!el) return;
  el.textContent = ok ? (msg || 'Server: OK') : (msg || 'Server: FAIL');
  el.classList.toggle('ok', !!ok);
  el.classList.toggle('bad', !ok);
}

async function probeHealth(base) {
  const url = joinUrl(base, '/health');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, mode: 'cors', signal: ctrl.signal });
    const ct = r.headers.get('content-type') || '';
    const txt = await r.text();
    dlog('probe', { base, status: r.status, ct });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, text: txt };
    if (!ct.includes('application/json')) return { ok: false, reason: 'not-json', text: txt };
    try {
      const j = JSON.parse(txt);
      if (j && (j.ok === true || 'ts' in j)) return { ok: true, json: j };
      return { ok: false, reason: 'json-no-ok', json: j };
    } catch (e) {
      return { ok: false, reason: 'json-parse', text: txt };
    }
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'error') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Descubre y fija la API (orden de prioridad):
 * 1) ?api=... en la URL
 * 2) localStorage 'sw:api_base'
 * 3) window.API_BASE (si lo inyectas antes)
 * 4) <meta name="api-base">
 * 5) location.origin + '/api'
 * 6) DEFAULT_API_BASE
 */
async function ensureApiBase() {
  const override = getQuery('api');                        // ?api=https://mi-api.xyz/api
  const cached   = localStorage.getItem(API_STORE_KEY) || '';
  const winSet   = (typeof window !== 'undefined' && window.API_BASE) || '';
  const metaTag  = getMeta('api-base') || '';
  const origin   = (typeof location !== 'undefined') ? (location.origin + '/api') : '';

  const candidates = [
    override,
    cached,
    winSet,
    metaTag,
    origin,
    DEFAULT_API_BASE,
  ].filter(Boolean).map(s => String(s).replace(/\/+$/, ''));

  const seen = new Set();
  const unique = candidates.filter(b => (seen.has(b) ? false : (seen.add(b), true)));

  dgroup('API candidates', () => console.table(unique.map((b,i)=>({ i, base:b }))));

  for (const base of unique) {
    const result = await probeHealth(base);
    dgroup(`probe ${base}`, () => console.log(result));
    if (result.ok) {
      API_BASE = base;
      try { localStorage.setItem(API_STORE_KEY, API_BASE); } catch {}
      if (typeof window !== 'undefined') window.API_BASE = API_BASE;
      dlog('Using API_BASE =', API_BASE);
      setServerStatus(true, 'Server: OK');
      return;
    }
  }
  console.warn('[API] No healthy base found. Using initial:', API_BASE || '(empty)');
  setServerStatus(false, 'Server: FAIL (no health)');
}

// ============================================================
//                        Estado
// ============================================================
let AUTH = { token: null, user: null };
const baseKey = (suffix) => (AUTH?.user?.id ? `sw:${AUTH.user.id}:${suffix}` : `sw:guest:${suffix}`);
let KEY_MSGS = baseKey('msgs');
let KEY_CHAR = baseKey('char');
let KEY_STEP = baseKey('step');
let msgs = load(KEY_MSGS, []);
let character = load(KEY_CHAR, null);
let step = load(KEY_STEP, 'name');
let pendingRoll = null; // { skill?: string }

// ============================================================
//                        DOM
// ============================================================
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

// ============================================================
//                          BOOT
// ============================================================
(async function boot() {
  dlog('Boot start');
  await ensureApiBase();
  dlog('API_BASE ready =', API_BASE);

  try {
    const saved = JSON.parse(localStorage.getItem('sw:auth') || 'null');
    dlog('Saved auth =', saved);
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
  } catch (e) {
    dlog('Auth restore error:', e);
    authStatusEl.textContent = 'Sin conexión para validar sesión';
  }

  if (!msgs.length) {
    pushDM(`Bienvenid@ al **HoloCanal**. Aquí jugamos una historia viva de Star Wars.
Para empezar, inicia sesión (usuario + PIN). Luego crearemos tu identidad y entramos en escena.`);
  }
  render();
  dlog('Boot done');
})();

// ============================================================
//                       Utils / helpers
// ============================================================
function load(k, fb) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function now() { return Date.now(); }
function hhmm(ts) { return new Date(ts).toLocaleTimeString(); }

function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function formatMarkdown(t = '') {
  const safe = escapeHtml(t);
  return safe
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function emit(m) { msgs = [...msgs, m]; save(KEY_MSGS, msgs); render(); }
function pushDM(text) { emit({ user: 'Máster', text, kind: 'dm', ts: now() }); }
function pushUser(text) { emit({ user: character?.name || 'Tú', text, kind: 'user', ts: now() }); }

// ---- Fetch helpers con logging profundo
async function readMaybeJson(res) {
  const ct = res.headers.get('content-type') || '';
  const body = await res.text();
  if (ct.includes('application/json')) {
    try { return { json: JSON.parse(body), raw: body, ct, status: res.status }; }
    catch (e) { return { json: null, raw: body, ct, status: res.status, parseError: String(e) }; }
  }
  return { json: null, raw: body, ct, status: res.status };
}

async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH?.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  dgroup('api POST ' + url, () => console.log({ body }));
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await readMaybeJson(res);
  dgroup('api POST result ' + url, () => console.log(data));
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = res;
    err.data = data;
    throw err;
  }
  return data.json ?? {};
}

async function apiGet(path) {
  const headers = {};
  if (AUTH?.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  dgroup('api GET ' + url, () => console.log({}));
  const res = await fetch(url, { method: 'GET', headers });
  const data = await readMaybeJson(res);
  dgroup('api GET result ' + url, () => console.log(data));
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = res;
    err.data = data;
    throw err;
  }
  return data.json ?? {};
}

// ============================================================
//                         Render
// ============================================================
function render() {
  dgroup('render', () => console.log({ msgsCount: msgs.length, step, character }));
  chatEl.innerHTML = msgs.map(m => `
    <div class="msg ${m.kind}">
      <div class="meta">[${hhmm(m.ts)}] ${escapeHtml(m.user)}</div>
      <div class="text">${formatMarkdown(m.text)}</div>
    </div>
  `).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
  updatePlaceholder();
  updateRollCta();
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

// --- Detectar etiqueta de tirada en el texto del Máster ---
function parseRollTag(txt = '') {
  // Acepta: <<ROLL SKILL="Combate" REASON="...">>
  const re = /<<\s*ROLL\b(?:\s+SKILL\s*=\s*"([^"]*)")?(?:\s+REASON\s*=\s*"([^"]*)")?\s*>>/i;
  const m = re.exec(txt);
  if (!m) return null;
  const skill = (m[1] || 'Acción').trim();
  const cleaned = txt.replace(re, '').trim();
  return { skill, cleaned };
}

// ============================================================
//                     Hablar con el Máster
// ============================================================
async function talkToDM(message) {
  dlog('talkToDM start', { message, step, character });
  try {
    const history = msgs.slice(-8);
    const res = await api('/dm/respond', {
      message,
      history,
      character,
      stage: step
    });

    let txt = res.text || 'El neón chisporrotea sobre la barra. ¿Qué haces?';

    const roll = parseRollTag(txt);
    if (roll) {
      pendingRoll = { skill: roll.skill };
      updateRollCta();
      txt = roll.cleaned || `Necesitamos una tirada para **${roll.skill}**. Pulsa “Resolver tirada”.`;
    }

    pushDM(txt);
  } catch (e) {
    dlog('talkToDM error:', e?.data || e);
    pushDM('El canal se llena de estática. Intenta de nuevo en un momento.');
  }
}

// ============================================================
//                       Send flow
// ============================================================
async function send() {
  const value = inputEl.value.trim(); if (!value) return;
  dlog('send', { value, step });

  // Comandos rápidos
  if ((value === '/privado' || value === '/publico') && character) {
    character.publicProfile = (value === '/publico');
    save(KEY_CHAR, character);
    try { await api('/world/characters', { character }); } catch (e) { dlog('privacy update fail', e?.data || e); }
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

  pushUser(value);

  if (step !== 'done') {
    if (step === 'name') {
      const name = value || 'Aventurer@';
      character = { name, species: '', role: '', publicProfile: true, lastLocation: 'Tatooine — Cantina de Mos Eisley' };
      save(KEY_CHAR, character);
      try { await api('/world/characters', { character }); } catch (e) { dlog('create char fail', e?.data || e); }
      step = 'species'; save(KEY_STEP, step);
    } else if (step === 'species') {
      const map = { humano: 'Humano', twi: "Twi'lek", wook: 'Wookiee', zabr: 'Zabrak', droid: 'Droide', droide: 'Droide' };
      const key = Object.keys(map).find(k => value.toLowerCase().startsWith(k));
      if (key) {
        character.species = map[key];
        save(KEY_CHAR, character);
        try { await api('/world/characters', { character }); } catch (e) { dlog('update species fail', e?.data || e); }
        step = 'role'; save(KEY_STEP, step);
      }
    } else if (step === 'role') {
      const map = { pilo: 'Piloto', piloto: 'Piloto', contra: 'Contrabandista', jedi: 'Jedi', caza: 'Cazarrecompensas', inge: 'Ingeniero', ingeniero: 'Ingeniero' };
      const key = Object.keys(map).find(k => value.toLowerCase().startsWith(k));
      if (key) {
        character.role = map[key];
        save(KEY_CHAR, character);
        try { await api('/world/characters', { character }); } catch (e) { dlog('update role fail', e?.data || e); }
        step = 'done'; save(KEY_STEP, step);
      }
    }
    await talkToDM(value);
    inputEl.value = '';
    return;
  }

  await talkToDM(value);
  inputEl.value = '';
}

let busy = false;
async function resolveRoll() {
  if (!pendingRoll || busy) return;
  busy = true;
  const skill = pendingRoll.skill || 'Acción';
  dlog('resolveRoll', { skill });
  try {
    const res = await api('/roll', { skill, character });
    const history = msgs.slice(-8);
    const follow = await api('/dm/respond', {
      message: `<<DICE_OUTCOME SKILL="${skill}" OUTCOME="${res.outcome}">>`,
      history,
      character,
      stage: step
    });
    const nextText = (follow && follow.text) ? follow.text : res.text;
    pushDM(nextText || res.text || 'La situación evoluciona…');
  } catch (e) {
    dlog('resolveRoll error', e?.data || e);
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

// ============================================================
//                     Auth (robusto con 404)
// ============================================================
async function doAuth(kind) {
  const username = (authUserEl.value || '').trim();
  const pin = (authPinEl.value || '').trim();
  if (!username || !/^\d{4}$/.test(pin)) { authStatusEl.textContent = 'Usuario y PIN (4 dígitos)'; return; }

  dlog('doAuth', { kind, username });
  try {
    const url = kind === 'register' ? '/auth/register' : '/auth/login';
    const { token, user } = (await api(url, { username, pin }));
    AUTH = { token, user };
    localStorage.setItem('sw:auth', JSON.stringify(AUTH));

    // reset keys/estado de usuario
    KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step');
    msgs = load(KEY_MSGS, []);
    character = load(KEY_CHAR, null);
    step = load(KEY_STEP, 'name');

    // Intentar recuperar personaje — si 404, lo ignoramos y seguimos con sesión OK
    let me = null;
    try {
      me = await apiGet('/world/characters/me');
    } catch (e) {
      if (e?.response?.status !== 404) throw e; // sólo ignoramos 404
      dlog('characters/me not found (se ignora y se continúa)', e?.data || e);
    }

    if (me?.character) { character = me.character; save(KEY_CHAR, character); }

    authStatusEl.textContent = `Hola, ${user.username}`;

    if (character?.name && step !== 'done') {
      step = 'done'; save(KEY_STEP, step);
      pushDM(`Salud de nuevo, **${character.name}**. Retomamos en **${character.lastLocation || 'la cantina'}**.`);
    }
    render();
  } catch (e) {
    dlog('doAuth error:', e?.data || e);
    let code = '';
    try {
      code = (e.data?.json?.error) || (await e.response?.json?.())?.error || '';
    } catch {}

    const friendly = {
      INVALID_CREDENTIALS: 'Usuario (3–24 minúsculas/números/_) y PIN de 4 dígitos.',
      USERNAME_TAKEN: 'Ese usuario ya existe.',
      USER_NOT_FOUND: 'Usuario no encontrado.',
      INVALID_PIN: 'PIN incorrecto.',
      unauthorized: 'No autorizado.',
      not_found: 'Recurso no encontrado.',
    };

    authStatusEl.textContent = (code && (friendly[code] || code)) || 'Error de autenticación';
  }
}

// (helper opcional que usas más abajo)
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
