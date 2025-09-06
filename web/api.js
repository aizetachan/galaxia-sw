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

// API base para compatibilidad
export const API_BASE = '/api';

// Helper para unir URLs
export function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

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

// Health check simplificado para el mismo dominio
export async function probeHealth() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch('/api/health', { 
      method: 'GET', 
      headers: { 'Accept': 'application/json' }, 
      credentials: 'include',
      signal: ctrl.signal 
    });
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
