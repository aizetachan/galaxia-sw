// === DEBUG helpers ===
const DEBUG = true;
export function dlog(...a) { if (DEBUG) console.log('[WEB]', ...a); }
export function dgroup(label, fn) {
  if (!DEBUG) return fn?.();
  console.groupCollapsed(label);
  try { fn?.(); } finally { console.groupEnd(); }
}

export const API_STORE_KEY = 'sw:api_base';
export const DEFAULT_API_BASE = 'https://galaxia-sw.vercel.app/api';

export function getMeta(name) {
  try { return document.querySelector(`meta[name="${name}"]`)?.content || ''; } catch { return ''; }
}

export function getQuery(name) {
  try { const u = new URL(location.href); return u.searchParams.get(name) || ''; } catch { return ''; }
}

export function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/,'');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

export let API_BASE =
  (typeof window !== 'undefined' && window.API_BASE) ||
  getMeta('api-base') ||
  (typeof location !== 'undefined' ? (location.origin + '/api') : '') ||
  DEFAULT_API_BASE;

export function setServerStatus(ok, msg) {
  const el = document.getElementById('server-status');
  if (!el) return;
  const mode = typeof window !== 'undefined' && typeof window.getDmMode === 'function'
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

export async function ensureApiBase() {
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
      setServerStatus(true, `Server: OK — M: ${typeof window !== 'undefined' && typeof window.getDmMode === 'function' ? window.getDmMode() : 'rich'}`);
      return;
    }
  }
  console.warn('[API] No healthy base found. Using initial:', API_BASE || '(empty)');
  setServerStatus(false, 'Server: FAIL (no health)');
}
