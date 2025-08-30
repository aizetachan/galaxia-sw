import { setServerStatus, dlog, getQuery } from './api.js';

// =========================
//   MODO DEL MÁSTER (ÚNICO)
// =========================
const DM_MODE_KEY = 'sw:dm_mode';
const VALID_MODES = new Set(['fast','rich']);

export function getDmMode(){
  const saved = (localStorage.getItem(DM_MODE_KEY) || '').toLowerCase();
  return VALID_MODES.has(saved) ? saved : 'rich';
}

export function setDmMode(mode){
  const m = (String(mode||'').toLowerCase());
  const next = VALID_MODES.has(m) ? m : 'rich';
  localStorage.setItem(DM_MODE_KEY, next);
  setServerStatus(true, `Server: OK — M: ${next}`);
  if (typeof window !== 'undefined' && typeof window.pushDM === 'function') {
    window.pushDM(`Modo del Máster fijado a ${next}.`);
  }
  dlog('DM mode ->', next);
}

// =========== Roll tags fallback ===========
export function asBool(v, def = true) {
  if (v == null || v === '') return def;
  const s = String(v).toLowerCase();
  return !['0','false','no','off','nope'].includes(s);
}

const adminPref = localStorage.getItem('sw:cfg:rolltags');
export let allowRollTagFallback = asBool(adminPref ?? getQuery('rolltags'), true);

export function setRollTagFallback(on) {
  allowRollTagFallback = asBool(on, true);
  localStorage.setItem('sw:cfg:rolltags', allowRollTagFallback ? '1':'0');
  if (typeof window !== 'undefined' && typeof window.pushDM === 'function') {
    window.pushDM(`Fallback de etiquetas de tirada ${allowRollTagFallback ? 'activado' : 'desactivado'}.`);
  }
}

if (typeof window !== 'undefined') {
  window.getDmMode = getDmMode;
  window.setDmMode = setDmMode;
  window.allowRollTagFallback = allowRollTagFallback;
  window.setRollTagFallback = setRollTagFallback;
}
