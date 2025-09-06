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

// Health check simplificado para el mismo dominio
export async function probeHealth() {
  console.log('[probeHealth] Starting health check...');
  console.log('[probeHealth] URL:', '/api/health');
  console.log('[probeHealth] Current location:', window.location.href);
  console.log('[probeHealth] User agent:', navigator.userAgent);
  
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    console.log('[probeHealth] Timeout reached (10s), aborting request');
    ctrl.abort();
  }, 10000);
  
  try {
    console.log('[probeHealth] Making fetch request...');
    const r = await fetch('/api/health', { 
      method: 'GET', 
      headers: { 'Accept': 'application/json' }, 
      credentials: 'include',
      signal: ctrl.signal 
    });
    
    console.log('[probeHealth] Response received:');
    console.log('[probeHealth] Status:', r.status, r.statusText);
    console.log('[probeHealth] Headers:', Object.fromEntries(r.headers.entries()));
    console.log('[probeHealth] OK:', r.ok);
    
    const ct = r.headers.get('content-type') || '';
    console.log('[probeHealth] Content-Type:', ct);
    
    const txt = await r.text();
    console.log('[probeHealth] Response text:', txt);
    
    if (!r.ok) {
      console.log('[probeHealth] HTTP error:', r.status);
      return { ok: false, reason: `HTTP ${r.status}`, text: txt };
    }
    
    if (!ct.includes('application/json')) {
      console.log('[probeHealth] Not JSON response');
      return { ok: false, reason: 'not-json', text: txt };
    }
    
    try {
      const j = JSON.parse(txt);
      console.log('[probeHealth] Parsed JSON:', j);
      
      if (j && (j.ok === true || 'ts' in j)) {
        console.log('[probeHealth] Health check successful');
        return { ok: true, json: j };
      }
      
      console.log('[probeHealth] JSON response invalid (no ok=true or ts)');
      return { ok: false, reason: 'json-no-ok', json: j };
    } catch (parseError) {
      console.error('[probeHealth] JSON parse error:', parseError);
      return { ok: false, reason: 'json-parse', text: txt };
    }
  } catch (e) {
    console.error('[probeHealth] Fetch error:');
    console.error('[probeHealth] Error type:', e.constructor.name);
    console.error('[probeHealth] Error message:', e.message);
    console.error('[probeHealth] Error name:', e.name);
    console.error('[probeHealth] Full error:', e);
    
    const reason = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'error');
    console.log('[probeHealth] Returning error result:', { ok: false, reason });
    return { ok: false, reason };
  } finally { 
    clearTimeout(timer);
    console.log('[probeHealth] Health check completed');
  }
}
