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
  } catch { return ''; }
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
    } catch {
      return { ok: false, reason: 'json-parse', text: txt };
    }
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'error') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Descubre y fija la API (nuevo orden: preferimos ventana/origen sobre caché)
 * 1) ?api=...
 * 2) window.API_BASE
 * 3) location.origin + '/api'
 * 4) <meta name="api-base">
 * 5) DEFAULT_API_BASE
 * 6) localStorage 'sw:api_base' (AL FINAL para evitar bases antiguas)
 */
async function ensureApiBase() {
  const override = getQuery('api');
  const winSet   = (typeof window !== 'undefined' && window.API_BASE) || '';
  const origin   = (typeof location !== 'undefined') ? (location.origin + '/api') : '';
  const metaTag  = getMeta('api-base') || '';
  const cached   = localStorage.getItem(API_STORE_KEY) || '';

  const candidates = [override, winSet, origin, metaTag, DEFAULT_API_BASE, cached]
    .filter(Boolean)
    .map(s => String(s).replace(/\/+$/, ''));

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
let KEY_CONFIRM = baseKey('confirm');

let msgs = load(KEY_MSGS, []);
let character = load(KEY_CHAR, null);
let step = load(KEY_STEP, 'name');
let pendingRoll = null; // { skill?: string }
let pendingConfirm = load(KEY_CONFIRM, null); // { type:'name'|'build', name?, species?, role? }
let lastRoll = null;

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
const rollTitleEl = document.getElementById('roll-title');
const rollOutcomeEl = document.getElementById('roll-outcome');
// Confirm CTA
const confirmCta = document.getElementById('confirm-cta');
const confirmSummaryEl = document.getElementById('confirm-summary');
const confirmYesBtn = document.getElementById('confirm-yes');
const confirmNoBtn  = document.getElementById('confirm-no');

// ============================================================
//                       Utils / helpers
// ============================================================
function load(k, fb) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function now() { return Date.now(); }
function hhmm(ts) { return new Date(ts).toLocaleTimeString(); }
function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatMarkdown(t = '') {
  const safe = escapeHtml(t);
  return safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}
function emit(m) { msgs = [...msgs, m]; save(KEY_MSGS, msgs); render(); }
function pushDM(text) { emit({ user: 'Máster', text, kind: 'dm', ts: now() }); }
function pushUser(text) { emit({ user: character?.name || 'Tú', text, kind: 'user', ts: now() }); }

// Payload plano + anidado para /world/characters
function charPayload(c) {
  return {
    name: c?.name || '',
    species: c?.species || '',
    role: c?.role || '',
    publicProfile: c?.publicProfile ?? true,
    character: c || null,
  };
}

// ---- Fetch helpers
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
      KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step'); KEY_CONFIRM = baseKey('confirm');
      msgs = load(KEY_MSGS, []); character = load(KEY_CHAR, null); step = load(KEY_STEP, 'name'); pendingConfirm = load(KEY_CONFIRM, null);
      authStatusEl.textContent = `Hola, ${saved.user.username}`;
    } else {
      AUTH = null;
      localStorage.removeItem('sw:auth');
      KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step'); KEY_CONFIRM = baseKey('confirm');
      msgs = load(KEY_MSGS, []); character = load(KEY_CHAR, null); step = load(KEY_STEP, 'name'); 
      // Limpieza de confirmación fantasma para invitado
      pendingConfirm = null; save(KEY_CONFIRM, null);
    }
  } catch (e) {
    dlog('Auth restore error:', e);
    authStatusEl.textContent = 'Sin conexión para validar sesión';
  }

  if ((AUTH?.user?.id) && msgs.length === 0) {
    await showResumeIfAny();
  }
  if (msgs.length === 0) {
    pushDM(`Bienvenid@ al **HoloCanal**. Aquí jugamos una historia viva de Star Wars.
Para empezar, inicia sesión (usuario + PIN). Luego crearemos tu identidad y entramos en escena.`);
  }

  // Listeners (tras construir estado y DOM)
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  resolveBtn.addEventListener('click', resolveRoll);
  authLoginBtn.addEventListener('click', () => doAuth('login'));
  authRegisterBtn.addEventListener('click', () => doAuth('register'));
  cancelBtn.addEventListener('click', () => {
    pushDM('🎲 Tirada cancelada (… )');
    pendingRoll = null;
    updateRollCta();
  });
  if (confirmYesBtn) confirmYesBtn.addEventListener('click', () => handleConfirmDecision('yes'));
  if (confirmNoBtn)  confirmNoBtn.addEventListener('click',  () => handleConfirmDecision('no'));

  render();
  dlog('Boot done');
})();

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
  updateConfirmCta();
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
    rollSkillEl.textContent = '';
  }
}

// --- Detectar etiqueta de tirada ---
function parseRollTag(txt = '') {
  const re = /<<\s*ROLL\b(?:\s+SKILL\s*=\s*"([^"]*)")?(?:\s+REASON\s*=\s*"([^"]*)")?\s*>>/i;
  const m = re.exec(txt);
  if (!m) return null;
  const skill = (m[1] || 'Acción').trim();
  const cleaned = txt.replace(re, '').trim();
  return { skill, cleaned };
}

// --- Detectar etiqueta de confirmación ---
function parseConfirmTag(txt = '') {
  const re = /<<\s*CONFIRM\b([^>]*)>>/i;
  const m = re.exec(txt);
  if (!m) return null;
  const attrsStr = m[1] || '';
  const attrs = {};
  for (const mm of attrsStr.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
    attrs[mm[1].toUpperCase()] = mm[2];
  }
  let pending = null;
  if (attrs.NAME) pending = { type: 'name', name: attrs.NAME };
  else if (attrs.SPECIES && attrs.ROLE) pending = { type: 'build', species: attrs.SPECIES, role: attrs.ROLE };
  const cleaned = txt.replace(re, '').trim();
  return { pending, cleaned };
}

// ====== CTA de Confirmación ======
function mapStageForDM(s) { if (s === 'species' || s === 'role') return 'build'; return s || 'name'; }

function updateConfirmCta() {
  if (!confirmCta || !confirmSummaryEl) return;
  if (!pendingConfirm) {
    confirmCta.classList.add('hidden');
    confirmSummaryEl.textContent = '—';
    return;
  }
  confirmSummaryEl.textContent =
    (pendingConfirm.type === 'name')
      ? `¿Confirmas el nombre: “${pendingConfirm.name}”?`
      : `¿Confirmas: ${pendingConfirm.species} — ${pendingConfirm.role}?`;
  confirmCta.classList.remove('hidden');
}

// ====== Helper central para pintar respuestas del Máster ======
function handleIncomingDMText(rawText) {
  let txt = rawText || 'El neón chisporrotea sobre la barra. ¿Qué haces?';

  // Confirmación
  const conf = parseConfirmTag(txt);
  if (conf) {
    pendingConfirm = conf.pending;
    save(KEY_CONFIRM, pendingConfirm);
    updateConfirmCta();
    txt = conf.cleaned || txt;
  }

  // Tirada
  const roll = parseRollTag(txt);
  if (roll) {
    pendingRoll = { skill: roll.skill };
    updateRollCta();
    txt = roll.cleaned || `Necesitamos una tirada para **${roll.skill}**. Pulsa “Resolver tirada”.`;
  }

  pushDM(txt);
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
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step)
    });
    handleIncomingDMText(res.text);
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

  // Si hay confirmación pendiente, no avances el flujo antiguo; deja que lo gestione el Máster.
  if (pendingConfirm && step !== 'done') {
    pushUser(value);
    await talkToDM(value);
    inputEl.value = '';
    return;
  }

  // Comandos rápidos
  if ((value === '/privado' || value === '/publico') && character) {
    character.publicProfile = (value === '/publico');
    save(KEY_CHAR, character);
    try { await api('/world/characters', charPayload(character)); }
    catch (e) { dlog('privacy update fail', e?.data || e); }
    inputEl.value = ''; return;
  }

  if (value === '/restart') {
    localStorage.removeItem(KEY_MSGS);
    localStorage.removeItem(KEY_CHAR);
    localStorage.removeItem(KEY_STEP);
    localStorage.removeItem(KEY_CONFIRM);
    msgs = []; character = null; step = 'name'; pendingRoll = null; pendingConfirm = null;
    pushDM(`Bienvenid@ al **HoloCanal**. Soy tu **Máster**. Vamos a registrar tu identidad para entrar en la galaxia.\n\nPrimero: ¿cómo te llamas en la red del HoloNet?`);
    inputEl.value = ''; return;
  }

  pushUser(value);

  if (step !== 'done') {
    if (step === 'name') {
      const name = value || 'Aventurer@';
      character = { name, species: '', role: '', publicProfile: true, lastLocation: 'Tatooine — Cantina de Mos Eisley' };
      save(KEY_CHAR, character);
      try {
        const r = await api('/world/characters', charPayload(character));
        if (r?.character?.id) { character.id = r.character.id; save(KEY_CHAR, character); }
      } catch (e) { dlog('create char fail', e?.data || e); }
      step = 'species'; save(KEY_STEP, step);
    } else if (step === 'species') {
      const map = { humano: 'Humano', twi: "Twi'lek", wook: 'Wookiee', zabr: 'Zabrak', droid: 'Droide', droide: 'Droide' };
      const key = Object.keys(map).find(k => value.toLowerCase().startsWith(k));
      if (key) {
        character.species = map[key];
        save(KEY_CHAR, character);
        try {
          const r = await api('/world/characters', charPayload(character));
          if (r?.character?.id && !character.id) { character.id = r.character.id; }
          save(KEY_CHAR, character);
        } catch (e) { dlog('update species fail', e?.data || e); }
        step = 'role'; save(KEY_STEP, step);
      }
    } else if (step === 'role') {
      const map = { pilo: 'Piloto', piloto: 'Piloto', contra: 'Contrabandista', jedi: 'Jedi', caza: 'Cazarrecompensas', inge: 'Ingeniero', ingeniero: 'Ingeniero' };
      const key = Object.keys(map).find(k => value.toLowerCase().startsWith(k));
      if (key) {
        character.role = map[key];
        save(KEY_CHAR, character);
        try {
          const r = await api('/world/characters', charPayload(character));
          if (r?.character?.id && !character.id) { character.id = r.character.id; }
          save(KEY_CHAR, character);
        } catch (e) { dlog('update role fail', e?.data || e); }
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
    const res = await api('/roll', { skill });
    pushDM(`🎲 **Tirada** (${skill}): ${res.roll} → ${res.outcome}`);

    const outcomeText = (typeof res.roll !== 'undefined') ? ` · ${res.roll} → ${res.outcome}` : ` · ${res.outcome || 'resultado'}`;
    lastRoll = { skill, outcomeText };
    updateRollCta();

    const history = msgs.slice(-8);
    const follow = await api('/dm/respond', {
      message: `<<DICE_OUTCOME SKILL="${skill}" OUTCOME="${res.outcome}">>`,
      history,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step)
    });

    handleIncomingDMText((follow && follow.text) ? follow.text : res.text);

  } catch (e) {
    dlog('resolveRoll error', e?.data || e);
    pushDM('Algo se interpone; la situación se complica.');
  } finally {
    busy = false;
    pendingRoll = null;
    updateRollCta();
    render();
  }
}

// ====== Handler de confirmación Sí/No ======
let busyConfirm = false;
async function handleConfirmDecision(decision) {
  if (!pendingConfirm || busyConfirm) return;
  busyConfirm = true;
  const { type } = pendingConfirm;

  try {
    if (decision === 'yes') {
      if (type === 'name') {
        if (!character) {
          character = { name: pendingConfirm.name, species: '', role: '', publicProfile: true, lastLocation: 'Tatooine — Cantina de Mos Eisley' };
        } else {
          character.name = pendingConfirm.name;
        }
        save(KEY_CHAR, character);
        try {
          const r = await api('/world/characters', charPayload(character));
          if (r?.character?.id) { character.id = r.character.id; save(KEY_CHAR, character); }
        } catch (e) { dlog('upsert name fail', e?.data || e); }
        step = 'species'; save(KEY_STEP, step);
      } else if (type === 'build') {
        if (!character) {
          character = { name: 'Aventurer@', species: pendingConfirm.species, role: pendingConfirm.role, publicProfile: true };
        } else {
          character.species = pendingConfirm.species;
          character.role = pendingConfirm.role;
        }
        save(KEY_CHAR, character);
        try {
          const r = await api('/world/characters', charPayload(character));
          if (r?.character?.id && !character.id) { character.id = r.character.id; save(KEY_CHAR, character); }
        } catch (e) { dlog('upsert build fail', e?.data || e); }
        step = 'done'; save(KEY_STEP, step);
      }
    }

    // Limpiar CTA siempre (tanto si YES como NO)
    pendingConfirm = null;
    save(KEY_CONFIRM, null);
    updateConfirmCta();

    const history = msgs.slice(-8);
    const follow = await api('/dm/respond', {
      message: `<<CONFIRM_ACK TYPE="${type}" DECISION="${decision}">>`,
      history,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step)
    });

    handleIncomingDMText((follow && follow.text) ? follow.text : '');

  } catch (e) {
    dlog('handleConfirmDecision error', e?.data || e);
    alert(e.message || 'No se pudo procesar la confirmación');
  } finally {
    busyConfirm = false;
    render();
  }
}

// Migración guest → user (opcional)
function migrateGuestToUser(userId) {
  const load = (k) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } };
  const gMsgs = load('sw:guest:msgs');
  const gChar = load('sw:guest:char');
  const gStep = load('sw:guest:step');
  const gConfirm = load('sw:guest:confirm');
  const kMsgs = `sw:${userId}:msgs`;
  const kChar = `sw:${userId}:char`;
  const kStep = `sw:${userId}:step`;
  const kConfirm = `sw:${userId}:confirm`;
  if (gMsgs && !localStorage.getItem(kMsgs)) localStorage.setItem(kMsgs, JSON.stringify(gMsgs));
  if (gChar && !localStorage.getItem(kChar)) localStorage.setItem(kChar, JSON.stringify(gChar));
  if (gStep && !localStorage.getItem(kStep)) localStorage.setItem(kStep, JSON.stringify(gStep));
  if (gConfirm && !localStorage.getItem(kConfirm)) localStorage.setItem(kConfirm, JSON.stringify(gConfirm));
  localStorage.removeItem('sw:guest:msgs');
  localStorage.removeItem('sw:guest:char');
  localStorage.removeItem('sw:guest:step');
  localStorage.removeItem('sw:guest:confirm');
}

// ============================================================
//                 /dm/resume helper
// ============================================================
async function showResumeIfAny() {
  try {
    const r = await apiGet('/dm/resume');
    if (r?.ok && !r.empty && r.text) {
      if (r.character) {
        character = r.character;
        save(KEY_CHAR, character);
        if (step !== 'done') { step = 'done'; save(KEY_STEP, step); }
      }
      pushDM(r.text);
    }
  } catch (e) {
    dlog('resume fail', e?.data || e);
  }
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

    // Migrar contenido guest a usuario real (si existía)
    migrateGuestToUser(user.id);

    // reset keys/estado de usuario
    KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step'); KEY_CONFIRM = baseKey('confirm');
    msgs = load(KEY_MSGS, []); character = load(KEY_CHAR, null); step = load(KEY_STEP, 'name'); pendingConfirm = load(KEY_CONFIRM, null);

    // Intentar recuperar personaje — si 404, lo ignoramos y seguimos con sesión OK
    let me = null;
    try { me = await apiGet('/world/characters/me'); }
    catch (e) { if (e?.response?.status !== 404) throw e; dlog('characters/me not found', e?.data || e); }

    if (me?.character) { character = me.character; save(KEY_CHAR, character); }

    authStatusEl.textContent = `Hola, ${user.username}`;

    // Si el chat está vacío tras login, pedimos /dm/resume para saludar con resumen
    if (msgs.length === 0) {
      await showResumeIfAny();
      if (msgs.length === 0 && character?.name && step !== 'done') {
        step = 'done'; save(KEY_STEP, step);
        pushDM(`Salud de nuevo, **${character.name}**. Retomamos en **${character.lastLocation || 'la cantina'}**.`);
      }
    }

    render();

    // Kickoff onboarding si no está completado — pinta el primer mensaje
    if (msgs.length === 0 && step !== 'done') {
      try {
        const kick = await api('/dm/respond', {
          message: '',
          history: [],
          character_id: Number(character?.id) || null,
          stage: mapStageForDM(step)
        });
        handleIncomingDMText(kick.text);
      } catch (e) { dlog('kickoff fail', e?.data || e); }
    }

  } catch (e) {
    dlog('doAuth error:', e?.data || e);
    let code = '';
    try { code = (e.data?.json?.error) || (await e.response?.json?.())?.error || ''; } catch {}
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
