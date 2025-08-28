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
const DEFAULT_API_BASE = 'https://galaxia-sw.vercel.app/api';

function getMeta(name) {
  try { return document.querySelector(`meta[name="${name}"]`)?.content || ''; } catch { return ''; }
}
function getQuery(name) {
  try { const u = new URL(location.href); return u.searchParams.get(name) || ''; } catch { return ''; }
}

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/,'');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}
// --- MODO DEL MÁSTER (fast | rich) --------------------------
const DM_MODE = (getQuery('mode') || localStorage.getItem('sw:dm_mode') || '').toLowerCase();

// Cambiar modo desde consola o comando: setDmMode('fast'|'rich')
window.setDmMode = (m) => {
  try { localStorage.setItem('sw:dm_mode', String(m || '').toLowerCase()); } catch {}
  location.reload();
};

// === Config conmutador fallback de etiquetas ROLL ============================
function asBool(v, def = true) {
  if (v == null || v === '') return def;
  const s = String(v).toLowerCase();
  return !['0','false','no','off','nope'].includes(s);
}

// Preferencia admin (si existe) > parámetro URL (?rolltags=0|1) > por defecto TRUE
const adminPref = localStorage.getItem('sw:cfg:rolltags'); // '0' | '1' | null
const allowRollTagFallback = asBool(adminPref ?? getQuery('rolltags'), true);

// Exponer para depurar/cambiar desde consola o panel admin
window.allowRollTagFallback = allowRollTagFallback;
window.setRollTagFallback = (on) => {
  const val = asBool(on, true) ? '1' : '0';
  localStorage.setItem('sw:cfg:rolltags', val);
  location.reload();
  dlog('rolltag fallback =', allowRollTagFallback);

};

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
    } catch { return { ok: false, reason: 'json-parse', text: txt }; }
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'error') };
  } finally { clearTimeout(timer); }
}

/**
 * Preferimos ventana/origen sobre caché para evitar API antiguas.
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

// Estados de carga UI
const UI = {
  sending: false,
  authLoading: false,
  authKind: null, // 'login' | 'register'
  confirmLoading: false,
};

// ============================================================
//                        DOM
// ============================================================
const chatEl = document.getElementById('chat');   // <— ANCLAJE



/* === BEGIN identity-bar (global + seguro) === */
const chatWrap = document.querySelector('.chat-wrap');
let identityEl = document.getElementById('identity-bar');
if (!identityEl) {
  identityEl = document.createElement('section');
  identityEl.id = 'identity-bar';
  identityEl.className = 'identity-bar hidden';
  chatWrap.insertBefore(identityEl, chatEl); // mismo ancho y flujo que el chat
}

function setIdentityBar(userName, characterName){
  const u = String(userName || '').trim();
  const isGuest = /^guest$/i.test(u);
  if (!u || isGuest){
    identityEl.classList.add('hidden');
    identityEl.innerHTML = '';
    return;
  }
  const c = String(characterName || '').trim();
  identityEl.innerHTML = `
  <div class="id-row">
    <div class="id-left">
      <div class="id-user">${escapeHtml(u)}</div>
      ${ c ? `<div class="id-char muted">— ${escapeHtml(c)}</div>` : '' }
    </div>
    <button id="logout-btn" class="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button>
  </div>
`;
const _logoutBtn = identityEl.querySelector('#logout-btn');
if (_logoutBtn) _logoutBtn.onclick = handleLogout;

  identityEl.classList.remove('hidden');
}

/* Exponer para consola y otros módulos */
window.setIdentityBar = setIdentityBar;


/* Helper para hidratar SIEMPRE desde el estado real */
/* Helper para hidratar SIEMPRE desde el estado real de la app */
function updateIdentityFromState(){
  // Usuario: de AUTH (fuente de verdad). Si no hay sesión, del input.
  const user = (AUTH?.user?.username) || '';
  // Personaje: del objeto 'character' que ya persistes con KEY_CHAR
  const char = character?.name || '';

  setIdentityBar(user, char);// setIdentityBar ya oculta si user === ''
}
window.updateIdentityFromState = updateIdentityFromState;

/* === END identity-bar === */


/* auto-hydratación básica (por si ya tienes sesión cargada) */

/* === END identity-bar harden === */

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
// (Confirmación inline dentro del chat)

// ============================================================
//        UI auth state (guest vs. logged) — SOLO PRESENTACIÓN
// ============================================================
function isLogged() {
  return !!(AUTH && AUTH.token && AUTH.user && AUTH.user.id);
}
function updateAuthUI() {
  const logged = isLogged();
  document.body.classList.toggle('is-guest', !logged);
  document.body.classList.toggle('is-logged', logged);
  const card = document.getElementById('guest-card');
  if (card) card.hidden = !!logged; // si no existe, no pasa nada
}
// disponible por si quieres llamarlo externamente
window.updateAuthUI = updateAuthUI;
// refleja cambios desde otras pestañas/ventanas
window.addEventListener('storage', (e) => {
  if (e.key === 'sw:auth') {
    try { AUTH = JSON.parse(localStorage.getItem('sw:auth') || 'null') || null; } catch { AUTH = null; }
  }
  updateAuthUI();
});
function handleLogout(){
  try { localStorage.removeItem('sw:auth'); } catch {}
  AUTH = null;
  // Simula “cerrar pestaña y abrir de nuevo”
  location.reload();
}


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
// --- Acciones que consideramos "observación pasiva" (para no pedir tiradas por etiqueta)
const PASSIVE_VERBS = [
  'miro','observo','echo un vistazo','escucho',
  'me quedo quieto','me quedo quieta','esperar','esperando',
  'contemplo','analizo','reviso','vigilo'
];

// Payload plano + anidado para /world/characters
function charPayload(c) {
  return {
    name: c?.name || '',
    species: c?.species || '',
    role: c?.role || '',
    publicProfile: c?.publicProfile ?? true,
    lastLocation: c?.lastLocation || 'Tatooine — Cantina de Mos Eisley',
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
  if (DM_MODE) headers['X-DM-Mode'] = DM_MODE; 
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
  if (DM_MODE) headers['X-DM-Mode'] = DM_MODE; // 
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
//                Helpers de estados de CARGA (UI)
// ============================================================

// Bloquea/desbloquea el ancho actual del botón para que no “salte”
function lockWidth(el, on) {
  if (!el) return;
  if (on) {
    if (!el.dataset.w) el.dataset.w = el.offsetWidth + 'px';
    el.style.width = el.dataset.w;
  } else {
    el.style.width = '';
    delete el.dataset.w;
  }
}

function setSending(on) {
  UI.sending = !!on;
  try {
    sendBtn.disabled = !!on;
    inputEl.disabled = !!on;

    if (on) {
      lockWidth(sendBtn, true);
      sendBtn.classList.add('loading');
      if (!sendBtn.dataset.prev) sendBtn.dataset.prev = sendBtn.textContent || 'Enviar';
      sendBtn.textContent = sendBtn.dataset.prev;
    } else {
      sendBtn.classList.remove('loading');
      lockWidth(sendBtn, false);
      sendBtn.textContent = sendBtn.dataset.prev || 'Enviar';
      inputEl.disabled = false;
    }
  } catch {}
}

function setAuthLoading(on, kind = null) {
  UI.authLoading = !!on;
  UI.authKind = on ? kind : null;

  const targetBtn = (kind === 'login') ? authLoginBtn
                   : (kind === 'register') ? authRegisterBtn
                   : null;

  try {
    authUserEl.disabled = !!on;
    authPinEl.disabled = !!on;
    authLoginBtn.disabled = !!on;
    authRegisterBtn.disabled = !!on;

    if (on && targetBtn) {
      lockWidth(targetBtn, true);
      targetBtn.classList.add('loading');
      if (!targetBtn.dataset.prev) targetBtn.dataset.prev = targetBtn.textContent || (kind === 'login' ? 'Entrar' : 'Crear');
      targetBtn.textContent = targetBtn.dataset.prev;
    } else {
      for (const b of [authLoginBtn, authRegisterBtn]) {
        b.classList.remove('loading');
        lockWidth(b, false);
        if (b.dataset.prev) b.textContent = b.dataset.prev;
      }
    }
  } catch {}
}

function setConfirmLoading(on) {
  UI.confirmLoading = !!on;
  try {
    const yes = document.getElementById('confirm-yes-inline');
    const no  = document.getElementById('confirm-no-inline');
    if (yes) yes.disabled = !!on;
    if (no)  no.disabled  = !!on;

    if (on) {
      if (yes) { lockWidth(yes, true); yes.classList.add('loading'); yes.textContent = 'Sí'; }
      if (no)  { lockWidth(no,  true); no.classList.add('loading');  no.textContent  = 'No'; }
    } else {
      if (yes) { yes.classList.remove('loading'); lockWidth(yes, false); yes.textContent = 'Sí'; }
      if (no)  { no.classList.remove('loading');  lockWidth(no,  false); no.textContent  = 'No'; }
    }
  } catch {}
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
      pendingConfirm = null; save(KEY_CONFIRM, null);
    }
  } catch (e) {
    dlog('Auth restore error:', e);
    authStatusEl.textContent = 'Sin conexión para validar sesión';
  }

  // pinta estado visual de auth (guest/logged)
  updateAuthUI();

  if ((AUTH?.user?.id) && msgs.length === 0) {
    await showResumeIfAny();
  }
  if (msgs.length === 0) {
    pushDM(`Bienvenid@ al **HoloCanal**. Aquí jugamos una historia viva de Star Wars.
Para empezar, inicia sesión (usuario + PIN). Luego crearemos tu identidad y entramos en escena.`);
  }

  // Listeners
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

  render();
  dlog('Boot done');
})();

// ============================================================
//                         Render
// ============================================================
function render() {
  dgroup('render', () => console.log({ msgsCount: msgs.length, step, character, pendingConfirm }));

  // 1) pintar mensajes
  let html = msgs.map(m => {
    const isUser    = (m.kind === 'user');
    const metaAlign = isUser ? 'text-right' : '';
    const label     = escapeHtml(m.user) + ':';
  
    // Burbujas: USER se ancla a la derecha y ajusta al contenido
    const msgBoxStyle = isUser
      ? 'display:flex; flex-direction:column; align-items:flex-end; width:fit-content; max-width:min(72ch, 92%); margin-left:auto;'
      : 'width:fit-content; max-width:min(72ch, 92%);';
  
    // Texto dentro de la burbuja
    const textStyle = isUser ? 'text-align:left; width:100%;' : '';
  
    // Hora (fuera de la burbuja)
    const timeBoxBase  = 'background:none;border:none;box-shadow:none;padding:0;margin-top:2px;';
    const timeBoxStyle = isUser
      ? timeBoxBase + 'width:fit-content; margin-left:auto;'
      : timeBoxBase + 'width:fit-content;';
  
    return `
      <!-- Burbuja -->
      <div class="msg ${m.kind}" style="${msgBoxStyle}">
        <div class="meta ${metaAlign}">${label}</div>
        <div class="text" style="${textStyle}">${formatMarkdown(m.text)}</div>
      </div>
  
      <!-- Hora -->
      <div class="msg ${m.kind}" style="${timeBoxStyle}">
        <div class="meta ${metaAlign}" style="line-height:1;">${hhmm(m.ts)}</div>
      </div>
    `;
  }).join('');
  
  // 2) si hay confirmación, añadir bloque INLINE dentro del chat
  if (pendingConfirm) {
    const summary = (pendingConfirm.type === 'name')
      ? `¿Confirmas el nombre: “${escapeHtml(pendingConfirm.name)}”?`
      : `¿Confirmas: ${escapeHtml(pendingConfirm.species)} — ${escapeHtml(pendingConfirm.role)}?`;

    html += `
      <!-- Burbuja DM -->
      <div class="msg dm" style="width:fit-content; max-width:min(72ch, 85%);">
        <div class="meta meta--label">Máster:</div>
        <div class="text">
          <div class="confirm-cta-card">
            <strong>Confirmación:</strong> <span>${summary}</span>
            <div class="roll-cta__actions" style="margin-top:6px">
              <button id="confirm-yes-inline" type="button">Sí</button>
              <button id="confirm-no-inline" type="button" class="outline">No</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Hora DM -->
      <div class="msg dm" style="background:none;border:none;box-shadow:none;padding:0;margin-top:2px; width:fit-content;">
        <div class="meta meta--time" style="line-height:1;">${hhmm(now())}</div>
      </div>
    `;
  }

  updateIdentityFromState();

  chatEl.innerHTML = html;

  chatEl.scrollTop = chatEl.scrollHeight;

  // 3) actualizaciones varias
  updatePlaceholder();
  updateRollCta();

  // 4) bind de los botones inline (si existen)
  const yes = document.getElementById('confirm-yes-inline');
  const no  = document.getElementById('confirm-no-inline');
  if (yes) yes.onclick = () => handleConfirmDecision('yes');
  if (no)  no.onclick  = () => handleConfirmDecision('no');

  // 5) si había cargas en curso al re-renderizar, refléjalas
  setConfirmLoading(UI.confirmLoading);
  setSending(UI.sending);
  setAuthLoading(UI.authLoading, UI.authKind);
}

function updatePlaceholder() {
  const placeholders = {
    name: 'Tu nombre en el HoloNet…',
    species: 'Elige especie (Humano, Twi\'lek, Wookiee, Zabrak, Droide)…',
    role: 'Elige rol (Piloto, Contrabandista, Jedi, Cazarrecompensas, Ingeniero)…',
    done: 'Habla con el Master'
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

// ===== Resume helpers: limpiar comandos y re-inflar conversación =====
function stripProtoTags(s = '') {
  // quita <<...>> y espacios redundantes
  return String(s).replace(/<<[\s\S]*?>>/g, '').replace(/\s{2,}/g, ' ').trim();
}

function inflateTranscriptFromResume(text) {
  // convierte "Jugador: ..., · Máster: ..." en burbujas reales
  const cleaned = stripProtoTags(text).replace(/\(kickoff\)/ig, '').trim();
  const parts = cleaned.split(/\s*·\s*/g).map(p => p.trim()).filter(Boolean);
  const out = [];
  const ts = now();

  for (const p of parts) {
    const mDM   = p.match(/^(Máster|Master):\s*(.*)$/i);
    const mUser = p.match(/^Jugador(?:\/a|x|@)?\s*:\s*(.*)$/i);
    if (mDM)   out.push({ user: 'Máster', text: mDM[2], kind: 'dm',   ts });
    else if (mUser) out.push({ user: character?.name || 'Tú', text: mUser[1], kind: 'user', ts });
    else if (/^Salud de nuevo/i.test(p)) out.push({ user: 'Máster', text: p, kind: 'dm', ts });
  }
  return out;
}

// === Estado de cliente para el Máster (onboarding) ===
function getClientState() {
  return {
    step,
    name: (character?.name || pendingConfirm?.name || null),
    species: (character?.species || pendingConfirm?.species || null),
    role: (character?.role || pendingConfirm?.role || null),
    pendingConfirm: (pendingConfirm || null),
    sceneMemo: load('sw:scene_memo', []),

  };
}

function summarizeResumeEvents(rawText, maxItems = 6) {
  const bullets = [];
  const seen = new Set();
  const short = (s) => String(s).replace(/\s{2,}/g, ' ').trim().slice(0, 180);

  // 0) quitar tags/protocolos y trocear en partes "Máster:/Jugador:"
  const cleaned = stripProtoTags(rawText).replace(/\(kickoff\)/ig, '').trim();
  const parts = cleaned.split(/\s*·\s*/g).map(s => s.trim()).filter(Boolean);
  const dmParts   = parts.map(p => p.match(/^(?:Máster|Master):\s*(.+)$/i)?.[1]).filter(Boolean);
  const userParts = parts.map(p => p.match(/^Jugador(?:\/a|x|@)?\s*:\s*(.+)$/i)?.[1]).filter(Boolean);

  // 1) Ubicación de reenganche (si venía al principio)
  const loc = rawText.match(/Salud de nuevo.*?\s+en\s+([^.—]+)[.—]/i);
  if (loc && loc[1]) bullets.push(`Ubicación actual: ${short(loc[1])}`);

  // Helper para elegir la PRIMERA frase DM que cumpla un patrón
  const pick = (regexp, label) => {
    for (const t of dmParts) {
      const m = t.match(regexp);
      if (m) {
        const key = (label + '|' + m[0]).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          bullets.push(`${label}: ${short(t)}`);
          return true;
        }
      }
    }
    return false;
  };

  // 2) Pistas/objetos importantes (NO tiradas)
  pick(/\b(minidat|chip|coordenad|esquema|holoc|llave|contraseñ|mensaje cifrado|paquete|datacard)\b/i, 'Pista/objeto');

  // 3) Objetivo/Destino inmediato
  pick(/\b(dirígete|ve a|reúnete|entrega|llega a|punto de encuentro|Faro|muelle|cantina|puerto|mercado)\b/i, 'Objetivo');

  // 4) Tiempo límite / ventana temporal
  pick(/\b(media hora|\d+\s*(?:minutos?|horas?)|plazo|en\s+\d+\s*(?:minutos?|horas?))\b/i, 'Tiempo límite');

  // 5) Amenazas activas
  pick(/\b(dron(?:es)?|patrullas?|guardias?|imperiales?|alarma|persecución|enemig|cazarrecompensas)\b/i, 'Amenaza');

  // 6) Estado del personaje (lo que porta/consiguió)
  pick(/\b(tienes|llevas|guardas|consigues|obtienes|te entregan|recibes)\b/i, 'Estado');

  // 7) Última acción del jugador (para retomar)
  const lastUser = userParts.reverse().find(t =>
    t && !/^\/\w+/.test(t) && !/confirmo/i.test(t) && t.length > 6
  );
  if (lastUser) bullets.push(`Última acción: ${short(lastUser)}`);

  // Limita y devuelve
  return bullets.slice(0, maxItems);
}

async function showResumeOnDemand() {
  try {
    const r = await apiGet('/dm/resume');
    if (r?.ok && r.text) {
      const bullets = summarizeResumeEvents(r.text, 6);
      if (bullets.length) {
        pushDM(`**Resumen (eventos clave):**\n- ${bullets.join('\n- ')}`);
      } else {
        pushDM('No encontré eventos destacados en tu sesión.');
      }
    } else {
      pushDM('No hay resumen disponible.');
    }
  } catch (e) {
    dlog('resume on demand fail', e?.data || e);
    pushDM('No se pudo obtener el resumen ahora.');
  }
}

// --- Prioridad META JSON > etiquetas
function handleIncomingDMText(rawText) {
  let txt = String(rawText || '');

  // (1) limpia siempre la CTA de tirada al empezar
  pendingRoll = null;

  // 1) Primera línea cruda
  const nl = txt.indexOf('\n');
  const firstLine = (nl >= 0 ? txt.slice(0, nl) : txt).trim();
  dlog('RAW first line →', firstLine);

  // 2) Intentar leer META JSON de la 1ª línea (saneando bloque ```json)
  let meta = null;
  const first = firstLine.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const m = JSON.parse(first);
    if (m && typeof m === 'object' && ('roll' in m || 'memo' in m || 'options' in m)) meta = m;
  } catch {}

  let usedMeta = false;
  if (meta) {
    usedMeta = true;
    // quitar la 1ª línea (meta) del texto que se mostrará
    txt = (nl >= 0 ? txt.slice(nl + 1) : '').trim();

    // --- ROLL desde JSON (PRIORITARIO)
    if (typeof meta.roll === 'string' && meta.roll && meta.roll.toLowerCase() !== 'null') {
      const [skill, dc] = String(meta.roll).split(':');
      pendingRoll = { skill: (skill || 'Acción').trim(), dc: dc ? Number(dc) : null };
    }

    // --- MEMO
    if (Array.isArray(meta.memo) && meta.memo.length) {
      const prev = load('sw:scene_memo', []);
      save('sw:scene_memo', [...prev, ...meta.memo].slice(-10));
    }

    // --- OPTIONS
    if (Array.isArray(meta.options) && meta.options.length) {
      txt += '\n\nSugerencias: ' + meta.options.map(o => `“${o}”`).join(' · ');
    }

    dlog('META JSON', meta);
  }

  // 3) Confirmaciones (igual que antes)
  const c = parseConfirmTag(txt);
  if (c) {
    if (c.pending) pendingConfirm = c.pending;
    txt = c.cleaned;
  }

  // 4) Fallback a etiquetas SOLO si NO hubo meta JSON,
//    y controlado por el flag allowRollTagFallback.
//    Además, nunca se aplica para "observación pasiva".
if (!usedMeta) {
  if (!allowRollTagFallback) {
    // Forzamos a ignorar cualquier etiqueta de tirada
    txt = txt.replace(/<<\s*ROLL\b[\s\S]*?>>/gi, '').trim();
  } else {
    const lastUser = [...msgs].reverse().find(m => m.kind === 'user')?.text || '';
    const passiveObs = /\b(miro|observo|echo un vistazo|escucho|me quedo quiet[oa]|esperar|esperando|contemplo|analizo)\b/i.test(lastUser);

    if (passiveObs) {
      if (/<<\s*ROLL/i.test(txt)) dlog('ROLL tag ignorada (observación pasiva)');
      txt = txt.replace(/<<\s*ROLL\b[\s\S]*?>>/gi, '').trim();
    } else {
      const r = parseRollTag(txt);
      if (r) {
        pendingRoll = { skill: r.skill };
        txt = r.cleaned;
        dlog('ROLL by tag →', r.skill);
      }
    }
  }
} else {
  // Si vino meta y NO hay tirada, eliminamos etiquetas ROLL residuales
  if (!meta.roll || String(meta.roll).toLowerCase() === 'null') {
    txt = txt.replace(/<<\s*ROLL\b[\s\S]*?>>/gi, '').trim();
  }
}

  // 5) Mostrar siempre la prosa
  pushDM(txt);
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


// --- Detectar etiqueta de confirmación (robusto y global) ---
function parseConfirmTag(txt = '') {
  const tagRe = /<<\s*CONFIRM\b([\s\S]*?)>>/gi;
  let match, lastAttrs = null;
  let cleaned = txt;
  cleaned = cleaned.replace(tagRe, '').trim();
  while ((match = tagRe.exec(txt)) !== null) lastAttrs = match[1] || '';
  if (!lastAttrs) return null;

  const attrs = {};
  for (const mm of String(lastAttrs).matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[mm[1].toUpperCase()] = mm[2];
  let pending = null;
  if (attrs.NAME) pending = { type: 'name', name: attrs.NAME };
  else if (attrs.SPECIES && attrs.ROLE) pending = { type: 'build', species: attrs.SPECIES, role: attrs.ROLE };
  return { pending, cleaned };
}

// ====== CTA de Confirmación ======
function mapStageForDM(s) { if (s === 'species' || s === 'role') return 'build'; return s || 'name'; }


// ============================================================
//                     Hablar con el Máster
// ============================================================
async function talkToDM(message) {
  dlog('talkToDM start', { message, step, character, pendingConfirm });
  try {
    const history = msgs.slice(-8);
    const res = await api('/dm/respond', {
      message,
      history,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState()
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

  // Si hay una confirmación pendiente y el usuario escribe,
// lo tomamos como una nueva propuesta y cancelamos la confirmación actual.
if (pendingConfirm && step !== 'done') {
  pendingConfirm = null;
  save(KEY_CONFIRM, null);
  render(); // quita el bloque de confirmación inline
}


  dlog('send', { value, step });
  setSending(true);
  inputEl.value = '';

  // Comandos rápidos
  // /modo fast  |  /modo rich
if (/^\/modo\s+(fast|rich)\b/i.test(value)) {
  const m = RegExp.$1.toLowerCase();
  localStorage.setItem('sw:dm_mode', m);
  pushDM(`Modo del Máster fijado a **${m}**.`);
  location.reload();
  setSending(false);
  return;
}

  if ((value === '/privado' || value === '/publico') && character) {
    character.publicProfile = (value === '/publico');
    save(KEY_CHAR, character);
    try { await api('/world/characters', charPayload(character)); } catch (e) { dlog('privacy update fail', e?.data || e); }
    setSending(false);
    return;
  }
  if (value === '/resumen' || value === '/resume') {
    await showResumeOnDemand();
    setSending(false);
    return;
  }

  if (value === '/restart') {
    localStorage.removeItem(KEY_MSGS);
    localStorage.removeItem(KEY_CHAR);
    localStorage.removeItem(KEY_STEP);
    localStorage.removeItem(KEY_CONFIRM);
    msgs = []; character = null; step = 'name'; pendingRoll = null; pendingConfirm = null;
    pushDM(`Bienvenid@ al **HoloCanal**. Soy tu **Máster**. Vamos a registrar tu identidad para entrar en la galaxia.\n\nPrimero: ¿cómo se va a llamar tu personaje?`);
    setSending(false);
    return;
  }

  pushUser(value);

  // --- Onboarding por fases ---
  if (step !== 'done') {
    if (step === 'name') {
      const name = value || 'Aventurer@';
      character = { name, species: '', role: '', publicProfile: true, lastLocation: 'Tatooine — Cantina de Mos Eisley' };
      save(KEY_CHAR, character);

      pendingConfirm = { type: 'name', name };
      save(KEY_CONFIRM, pendingConfirm);

      render();
      setSending(false);
      return;
    }

    if (step === 'species') {
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

    try { await talkToDM(value); }
    finally { setSending(false); }
    return;
  }

  try { await talkToDM(value); }
  finally { setSending(false); }
}

let busy = false;
async function resolveRoll() {
  if (!pendingRoll || busy) return;
  busy = true;

  // Spinner en el botón "Resolver tirada"
  try {
    resolveBtn.disabled = true;
    resolveBtn.classList.add('loading');
    resolveBtn.setAttribute('aria-busy', 'true');
  } catch {}

  const skill = pendingRoll.skill || 'Acción';
  dlog('resolveRoll', { skill });

  // Marca visual de “resolviendo…” en el CTA (sin revelar resultado)
  try {
    rollSkillEl.textContent = pendingRoll.skill
      ? ` · ${pendingRoll.skill} — resolviendo…`
      : ' — resolviendo…';
  } catch {}

  let res = null;
  try {
    // 1) Tirada en servidor (NO mostramos nada todavía)
    res = await api('/roll', { skill });

    // 2) Enviamos el OUTCOME al DM y esperamos su respuesta
    const history = msgs.slice(-8);
    const follow = await api('/dm/respond', {
      message: `<<DICE_OUTCOME SKILL="${skill}" OUTCOME="${res.outcome}">>`,
      history,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState()
    });
    

    // 3) AHORA sí: publicamos el resultado de la tirada y, a continuación, la respuesta del Máster
    pushDM(`🎲 **Tirada** (${skill}): ${res.roll} → ${res.outcome}`);
    handleIncomingDMText(follow?.text || res.text || 'La situación evoluciona…');

  } catch (e) {
    dlog('resolveRoll error', e?.data || e);
    // Si hay tirada válida pero falló el follow-up, al menos mostramos el resultado
    if (res) pushDM(`🎲 **Tirada** (${skill}): ${res.roll} → ${res.outcome}`);
    pushDM('Algo se interpone; la situación se complica.');
  } finally {
    busy = false;
    pendingRoll = null;      // oculta el bloque inferior “Tirada: …”
    updateRollCta();
    render();
    try {
      resolveBtn.disabled = false;
      resolveBtn.classList.remove('loading');
      resolveBtn.removeAttribute('aria-busy');
    } catch {}
  }
}


// ====== Handler de confirmación Sí/No ======
let busyConfirm = false;
async function handleConfirmDecision(decision) {
  if (!pendingConfirm || busyConfirm) return;
  busyConfirm = true;
  setConfirmLoading(true);
  const { type } = pendingConfirm;

  try {
    if (decision === 'yes') {
      if (type === 'name') {
        if (!character) {
          character = { name: pendingConfirm.name, species: '', role: '', publicProfile: true, lastLocation: 'Tatooine — Cantina de Mos Eisley' };
        } else { character.name = pendingConfirm.name; }
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

    // limpiar CTA y notificar al Máster
    pendingConfirm = null;
    save(KEY_CONFIRM, null);

    const history = msgs.slice(-8);
    const follow = await api('/dm/respond', {
      message: `<<CONFIRM_ACK TYPE="${type}" DECISION="${decision}">>`,
      history,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState()
    });
    

    handleIncomingDMText((follow && follow.text) ? follow.text : '');

  } catch (e) {
    dlog('handleConfirmDecision error', e?.data || e);
    alert(e.message || 'No se pudo procesar la confirmación');
  } finally {
    busyConfirm = false;
    setConfirmLoading(false);
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
//                 /dm/resume helper (re-inflado)
// ============================================================
async function showResumeIfAny() {
  try {
    const r = await apiGet('/dm/resume');
    if (r?.ok && r.text && msgs.length === 0) {
      if (r.character) {
        character = r.character;
        save(KEY_CHAR, character);
        step = 'done';
        save(KEY_STEP, step);
      }
      const transcript = inflateTranscriptFromResume(r.text);
      if (transcript.length) {
        msgs = transcript;
        save(KEY_MSGS, msgs);
      }
    }
  } catch (e) { dlog('resume fail', e?.data || e); }
}


// ============================================================
//                     Auth (robusto con 404)
// ============================================================
async function doAuth(kind) {
  if (UI.authLoading) return;
  const username = (authUserEl.value || '').trim();
  const pin = (authPinEl.value || '').trim();
  if (!username || !/^\d{4}$/.test(pin)) { authStatusEl.textContent = 'Usuario y PIN (4 dígitos)'; return; }

  dlog('doAuth', { kind, username });
  setAuthLoading(true, kind);

  try {
    const url = kind === 'register' ? '/auth/register' : '/auth/login';
    const { token, user } = (await api(url, { username, pin }));
    AUTH = { token, user };
    localStorage.setItem('sw:auth', JSON.stringify(AUTH));

    migrateGuestToUser(user.id);

    KEY_MSGS = baseKey('msgs'); KEY_CHAR = baseKey('char'); KEY_STEP = baseKey('step'); KEY_CONFIRM = baseKey('confirm');
    msgs = load(KEY_MSGS, []); character = load(KEY_CHAR, null); step = load(KEY_STEP, 'name'); pendingConfirm = load(KEY_CONFIRM, null);

// ---- FIX: limpiar bienvenida 'guest' también en LOGIN ----
{
  const t0 = (Array.isArray(msgs) && msgs[0]?.text) ? String(msgs[0].text) : '';
  const esSoloBienvenida =
    Array.isArray(msgs) &&
    msgs.length <= 1 &&
    t0.includes('HoloCanal') &&
    t0.includes('inicia sesión');

  // Si solo tenemos la bienvenida copiada desde guest, la limpiamos
  if (esSoloBienvenida) {
    msgs = [];
    save(KEY_MSGS, msgs);
  }

  // En REGISTRO forzamos onboarding por nombre; en LOGIN no
  if (kind === 'register') {
    step = 'name';                    // empieza onboarding
    save(KEY_STEP, step);
    pendingConfirm = null;
    save(KEY_CONFIRM, null);
  }
}


    let me = null;
    try { me = await apiGet('/world/characters/me'); }
    catch (e) { if (e?.response?.status !== 404) throw e; dlog('characters/me not found', e?.data || e); }
    if (me?.character) {
      character = me.character;
      save(KEY_CHAR, character);
      // usuario existente → saltamos onboarding
      step = 'done';
      save(KEY_STEP, step);
    }

    authStatusEl.textContent = `Hola, ${user.username}`;
    setIdentityBar(user.username, character?.name || '');
    // pinta estado visual de auth (guest/logged)
    updateAuthUI();


    if (msgs.length === 0) {
      await showResumeIfAny();
      if (msgs.length === 0 && character?.name && step !== 'done') {
        step = 'done'; save(KEY_STEP, step);
        pushDM(`Salud de nuevo, **${character.name}**. Retomamos en **${character.lastLocation || 'la cantina'}**.`);
      }
    }

    render();

    // Kickoff onboarding si no está completado
    if (msgs.length === 0 && step !== 'done') {
      try {
        const kick = await api('/dm/respond', {
          message: '',
          history: [],
          character_id: Number(character?.id) || null,
          stage: mapStageForDM(step),
          clientState: getClientState()
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
  } finally {
    setAuthLoading(false);
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
// ===== Vídeo de fondo en la tarjeta de invitado (#guest-card) =====
(function setupGuestCardVideo(){
  // RUTAS RELATIVAS a web/index.html
  const VIDEO_SOURCES = [
    { src: 'assets/video/hero-home-720p.webm', type: 'video/webm' }, // ← sin barra inicial
    // Si más adelante añades MP4, descomenta la siguiente línea y sube el archivo:
    // { src: 'assets/video/hero-home-720p.mp4',  type: 'video/mp4'  },
  ];
  const POSTER = null; // p.ej. 'assets/posters/hero-home.jpg' si quieres poster

  function createVideo(){
    const v = document.createElement('video');
    v.id = 'guest-card-video';
    v.className = 'guest__bg';
    v.autoplay = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.setAttribute('aria-hidden','true');
    if (POSTER) v.setAttribute('poster', POSTER);
    VIDEO_SOURCES.forEach(s => {
      const src = document.createElement('source');
      src.src = s.src; src.type = s.type;
      v.appendChild(src);
    });
    return v;
  }

  function guestCardVisible(){
    const el = document.getElementById('guest-card');
    return !!el && !el.hasAttribute('hidden');
  }

  function mount(){
    if (navigator.connection?.saveData) return unmount(); // ahorro de datos
    const wrap = document.getElementById('guest-card');
    if (!wrap) return;
    if (!guestCardVisible() || isLogged()) return unmount(); // usa el isLogged() GLOBAL (AUTH)
    let v = document.getElementById('guest-card-video');
    if (!v) {
      v = createVideo();
      wrap.prepend(v);           // primer hijo => al fondo del contenedor
    }
    v.play?.().catch(()=>{});
  }

  function unmount(){
    const v = document.getElementById('guest-card-video');
    if (!v) return;
    try { v.pause(); } catch {}
    try {
      v.removeAttribute('src');
      while (v.firstChild) v.removeChild(v.firstChild);
      v.load();
    } catch {}
    v.remove();
  }

  const apply = () => { guestCardVisible() && !isLogged() ? mount() : unmount(); };

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', apply, { once:true });
  } else {
    apply();
  }

  document.addEventListener('visibilitychange', () => {
    const v = document.getElementById('guest-card-video');
    if (!v) return;
    if (document.hidden) v.pause(); else v.play?.().catch(()=>{});
  });

  // Re-aplicar cuando cambie el estado de sesión/visibilidad
  const orig = window.updateIdentityFromState;
  window.updateIdentityFromState = function(...args){
    try { return orig?.apply(this, args); }
    finally { apply(); }
  };
  const card = document.getElementById('guest-card');
  if (card && window.MutationObserver){
    new MutationObserver(apply).observe(card, { attributes:true, attributeFilter:['hidden','class','style'] });
  }
})();


