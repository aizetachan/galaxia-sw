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
  console.log('[setServerStatus] Called with:', { ok, msg });
  
  const el = document.getElementById('server-status');
  console.log('[setServerStatus] Element found:', !!el);
  
  if (!el) {
    console.warn('[setServerStatus] No server-status element found');
    return;
  }
  
  const mode = (typeof window !== 'undefined' && typeof window.getDmMode === 'function')
    ? window.getDmMode()
    : 'rich';
  console.log('[setServerStatus] DM mode:', mode);
  
  const label = ok ? (msg || `Server: OK — M: ${mode}`) : (msg || 'Server: FAIL');
  console.log('[setServerStatus] Setting label:', label);
  console.log('[setServerStatus] Setting classes - ok:', !!ok, 'bad:', !ok);
  
  el.textContent = label;
  el.classList.toggle('ok', !!ok);
  el.classList.toggle('bad', !ok);
  
  console.log('[setServerStatus] Element classes after:', el.className);
  console.log('[setServerStatus] Element text after:', el.textContent);
}

// Health check optimizado para máxima velocidad
export async function probeHealth() {
  let ctrl;
  let timer;

  try {
    ctrl = new AbortController();
    timer = setTimeout(() => {
      console.log('[probeHealth] Timeout after 30s');
      ctrl.abort('timeout');
    }, 30000);

    const r = await fetch('/api/health', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      signal: ctrl.signal
    });

    const txt = await r.text();

    if (!r.ok) {
      return { ok: false, reason: `HTTP ${r.status}` };
    }

    if (!r.headers.get('content-type')?.includes('application/json')) {
      return { ok: false, reason: 'not-json' };
    }

    try {
      const j = JSON.parse(txt);
      if (j && (j.ok === true || 'ts' in j)) {
        return { ok: true, json: j };
      }
      return { ok: false, reason: 'invalid-response' };
    } catch (parseError) {
      return { ok: false, reason: 'json-parse' };
    }
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { ok: false, reason: e.message || 'timeout' };
    }
    return { ok: false, reason: 'network-error' };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
