// === DEBUG helpers ===
const DEBUG = !(
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.PROD
);
export function dlog(...a) { if (DEBUG) console.log('[WEB]', ...a); }
export function dgroup(label, fn) {
  if (!DEBUG) return fn?.();
  console.groupCollapsed(label);
  try { fn?.(); } finally { console.groupEnd(); }
}

export const API_STORE_KEY = 'sw:api_base';

// Helpers seguros (sin duplicados)
function getMetaSafe(name) {
  try { return document.querySelector(`meta[name="${name}"]`)?.content || ''; } catch { return ''; }
}
function getQuerySafe(name) {
  try { return new URL(location.href).searchParams.get(name) || ''; } catch { return ''; }
}
export function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/,'');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

// Resolución de API base (orden: ?api → <meta api_base> → localStorage si coincide host → window.API_BASE → fallback same-origin)
export function resolveApiBase() {
  const q = getQuerySafe('api');
  if (q) { try { localStorage.setItem(API_STORE_KEY, q); } catch {} return q; }

  const meta = getMetaSafe('api_base');
  if (meta) return meta; // ← ahora el <meta> manda

  // Si había un valor cacheado, solo úsalo si coincide de host con la página actual
  const cached = (() => { try { return localStorage.getItem(API_STORE_KEY) || ''; } catch { return ''; } })();
  try {
    if (cached) {
      const loc = new URL(window.location.href);
      const api = new URL(cached, loc);
      if (api.origin === loc.origin) return api.toString(); // mismo host → ok
    }
  } catch {} // si falla el parseo, seguimos

  const win = (typeof window !== 'undefined' && window.API_BASE) ? String(window.API_BASE) : '';
  if (win) return win;

  // Fallback: misma origin + /api
  try {
    const loc = new URL(window.location.href);
    return new URL('/api', loc).toString();
  } catch {
    return '/api';
  }
}

export let API_BASE = resolveApiBase();

// UI: pinta estado del server en la badgita
export function setServerStatus(ok, msg) {
  const el = document.getElementById('server-status');
  if (!el) return;
  const mode = (typeof window !== 'undefined' && typeof window.getDmMode === 'function')
    ? window.getDmMode()
    : 'rich';
  const label = ok ? (msg || `Server: OK — M: ${mode}`) : (msg || 'Server: FAIL');
  el.textContent = label;
  el.classList.toggle('ok', !!ok);
  el.classList.toggle('bad', !ok);
}

export async function probeHealth(base) {
  const url = joinUrl(base, '/health');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, mode: 'cors', signal: ctrl.signal });
    const ct = r.headers.get('content-type') || '';
    const txt = await r.text();
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

// Establece API_BASE probando varios candidatos y pinta el estado
export async function ensureApiBase() {
  const override = getQuerySafe('api');
  const winSet   = (typeof window !== 'undefined' && window.API_BASE) || '';
  const origin   = (typeof location !== 'undefined') ? (location.origin + '/api') : '';
  const metaTag  = getMetaSafe('api_base') || '';
  const cached   = (() => { try { return localStorage.getItem(API_STORE_KEY) || ''; } catch { return ''; } })();

  const candidates = [override, cached, winSet, metaTag, origin, 'https://galaxia-sw.vercel.app/api']
    .filter(Boolean)
    .map(s => String(s).replace(/\/+$/, ''));

  // quitar duplicados manteniendo orden
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
      setServerStatus(true, `Server: OK — M: ${(typeof window !== 'undefined' && typeof window.getDmMode === 'function') ? window.getDmMode() : 'rich'}`);
      return API_BASE;
    }
  }
  console.warn('[API] No healthy base found. Using initial:', API_BASE || '(empty)');
  setServerStatus(false, 'Server: FAIL (no health)');
  return API_BASE;
}
