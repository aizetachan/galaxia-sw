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
// (Confirmación inline dentro del chat)

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
  let html = msgs.map(m => `
    <div class="msg ${m.kind}">
      <div class="meta">[${hhmm(m.ts)}] ${escapeHtml(m.user)}</div>
      <div class="text">${formatMarkdown(m.text)}</div>
    </div>
  `).join('');

  // 2) si hay confirmación, añadir bloque INLINE dentro del chat
  if (pendingConfirm) {
    const summary = (pendingConfirm.type === 'name')
      ? `¿Confirmas el nombre: “${escapeHtml(pendingConfirm.name)}”?`
      : `¿Confirmas: ${escapeHtml(pendingConfirm.species)} — ${escapeHtml(pendingConfirm.role)}?`;

    html += `
      <div class="msg dm">
        <div class="meta">[${hhmm(now())}] Máster</div>
        <div class="text">
          <div class="confirm-cta-card">
            <strong>Confirmación:</strong> <span>${summary}</span>
            <div class="roll-cta__actions" style="margin-top:8px">
              <button id="confirm-yes-inline" type="button">Sí</button>
              <button id="confirm-no-inline" type="button" class="outline">No</button>
            </div>
          </div>
        </div>
      </div>`;
  }

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

// ====== Helper central para pintar respuestas del Máster ======
function handleIncomingDMText(rawText) {
  let txt = rawText || 'El neón chisporrotea sobre la barra. ¿Qué haces?';

  // Confirmación que venga del Máster
  const conf = parseConfirmTag(txt);
  if (conf) {
    pendingConfirm = conf.pending;
    save(KEY_CONFIRM, pendingConfirm);
    txt = conf.cleaned || txt;
  }

  // Tirada
  const roll = parseRollTag(txt);
  if (roll) {
    pendingRoll = { skill: roll.skill };
    txt = roll.cleaned || `Necesitamos una tirada para **${roll.skill}**. Pulsa “Resolver tirada”.`;
  }

  pushDM(txt);
}

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

  if (pendingConfirm && step !== 'done') { inputEl.value = ''; return; }

  dlog('send', { value, step });
  setSending(true);
  inputEl.value = '';

  // Comandos rápidos
  if ((value === '/privado' || value === '/publico') && character) {
    character.publicProfile = (value === '/publico');
    save(KEY_CHAR, character);
    try { await api('/world/characters', charPayload(character)); } catch (e) { dlog('privacy update fail', e?.data || e); }
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
      stage: mapStageForDM(step)
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
      stage: mapStageForDM(step)
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

    let me = null;
    try { me = await apiGet('/world/characters/me'); }
    catch (e) { if (e?.response?.status !== 404) throw e; dlog('characters/me not found', e?.data || e); }
    if (me?.character) { character = me.character; save(KEY_CHAR, character); }

    authStatusEl.textContent = `Hola, ${user.username}`;

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
