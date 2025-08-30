import { API_BASE, joinUrl } from "../api.js";

// Session and localStorage management
export let AUTH = null;

export function baseKey(suffix) {
  return AUTH?.user?.id ? `sw:${AUTH.user.id}:${suffix}` : `sw:guest:${suffix}`;
}

export let KEY_MSGS = baseKey('msgs');
export let KEY_CHAR = baseKey('char');
export let KEY_STEP = baseKey('step');
export let KEY_CONFIRM = baseKey('confirm');

export function setAuth(auth) {
  AUTH = auth;
  KEY_MSGS = baseKey('msgs');
  KEY_CHAR = baseKey('char');
  KEY_STEP = baseKey('step');
  KEY_CONFIRM = baseKey('confirm');
}

export function load(k, fb) {
  try {
    const r = localStorage.getItem(k);
    return r ? JSON.parse(r) : fb;
  } catch {
    return fb;
  }
}

export function save(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export function isLogged() {
  return !!(AUTH && AUTH.token && AUTH.user && AUTH.user.id);
}

export async function handleLogout() {
  const headers = {};
  if (AUTH?.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  try {
    await fetch(joinUrl(API_BASE, '/auth/logout'), { method: 'POST', headers });
  } catch {}
  try { localStorage.removeItem('sw:auth'); } catch {}
  setAuth(null);
}

export function listenAuthChanges(onChange) {
  window.addEventListener('storage', (e) => {
    if (e.key === 'sw:auth') {
      try {
        const saved = JSON.parse(localStorage.getItem('sw:auth') || 'null') || null;
        setAuth(saved);
      } catch {
        setAuth(null);
      }
      if (typeof onChange === 'function') onChange();
    }
  });
}
