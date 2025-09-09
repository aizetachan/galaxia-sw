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
  console.log('[SESSION] 📋 Setting auth:', auth);

  // Validar auth antes de asignar
  if (auth !== null && typeof auth === 'object') {
    if (!auth.token || !auth.user?.id) {
      console.error('[SESSION] ❌ Invalid auth object, missing token or user.id:', auth);
      AUTH = null;
      return;
    }

    // Validar formato del token
    if (typeof auth.token !== 'string' || !auth.token.includes('.')) {
      console.error('[SESSION] ❌ Invalid token format:', auth.token);
      AUTH = null;
      return;
    }

    console.log('[SESSION] ✅ Auth validation passed');
  } else if (auth !== null) {
    console.error('[SESSION] ❌ Auth must be an object or null:', auth);
    AUTH = null;
    return;
  }

  AUTH = auth;
  KEY_MSGS = baseKey('msgs');
  KEY_CHAR = baseKey('char');
  KEY_STEP = baseKey('step');
  KEY_CONFIRM = baseKey('confirm');

  console.log('[SESSION] 📋 Auth set successfully, AUTH is now:', !!AUTH);
}

export function load(k, fb) {
  console.log('[SESSION] 📖 Loading from localStorage:', k);

  try {
    const rawData = localStorage.getItem(k);

    if (!rawData) {
      console.log('[SESSION] 📋 No data found for key:', k, 'returning fallback');
      return fb;
    }

    console.log('[SESSION] 📋 Raw data loaded, length:', rawData.length);

    // Verificar si contiene caracteres corruptos antes de parsear
    if (rawData.includes('\u0000') || rawData.includes('\ufffd')) {
      console.error('[SESSION] ❌ CRÍTICO: Loaded data contains corrupted characters!');
      console.error('[SESSION] ❌ Corrupted data for key:', k);
      console.log('[SESSION] 🧹 Removing corrupted data...');

      try {
        localStorage.removeItem(k);
        console.log('[SESSION] ✅ Corrupted data removed');
      } catch (cleanupError) {
        console.error('[SESSION] ❌ Failed to remove corrupted data:', cleanupError);
      }

      return fb;
    }

    const parsed = JSON.parse(rawData);
    console.log('[SESSION] ✅ Data loaded and parsed successfully from:', k);
    return parsed;

  } catch (error) {
    console.error('[SESSION] ❌ Error loading from localStorage:', k, error.message);
    console.error('[SESSION] ❌ Raw data that failed to parse:', localStorage.getItem(k));

    // Limpiar datos corruptos
    try {
      localStorage.removeItem(k);
      console.log('[SESSION] 🧹 Removed corrupted data for key:', k);
    } catch (cleanupError) {
      console.error('[SESSION] ❌ Failed to clean corrupted data:', cleanupError);
    }

    return fb;
  }
}

export function save(k, v) {
  console.log('[SESSION] 💾 Attempting to save to localStorage:', k, 'value type:', typeof v);

  try {
    // Validar que el valor se puede serializar
    const serialized = JSON.stringify(v);
    console.log('[SESSION] 📋 Data serialized successfully, length:', serialized.length);

    // Verificar que no contiene caracteres corruptos
    if (serialized.includes('\u0000') || serialized.includes('\ufffd')) {
      console.error('[SESSION] ❌ CRÍTICO: Data contains corrupted characters!');
      console.error('[SESSION] ❌ Corrupted data:', serialized);
      return;
    }

    localStorage.setItem(k, serialized);
    console.log('[SESSION] ✅ Data saved successfully to localStorage:', k);

  } catch (error) {
    console.error('[SESSION] ❌ Error saving to localStorage:', k, error.message);
    console.error('[SESSION] ❌ Data that failed to save:', v);

    // Intentar limpiar datos corruptos
    try {
      localStorage.removeItem(k);
      console.log('[SESSION] 🧹 Cleaned potentially corrupted data for key:', k);
    } catch (cleanupError) {
      console.error('[SESSION] ❌ Failed to clean corrupted data:', cleanupError);
    }
  }
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
  console.log('[SESSION] 👂 Setting up auth change listener');

  window.addEventListener('storage', (e) => {
    console.log('[SESSION] 📡 Storage event received:', e.key);

    if (e.key === 'sw:auth') {
      console.log('[SESSION] 🔄 Auth storage changed, reloading...');

      try {
        const rawData = localStorage.getItem('sw:auth');
        console.log('[SESSION] 📋 Raw auth data from storage event:', rawData);

        if (!rawData || rawData === 'null') {
          console.log('[SESSION] 📋 Auth cleared, setting to null');
          setAuth(null);
        } else {
          const saved = JSON.parse(rawData);
          console.log('[SESSION] 📋 Parsed auth data:', saved);

          // Validar antes de setAuth
          if (saved && saved.token && saved.user?.id) {
            setAuth(saved);
          } else {
            console.error('[SESSION] ❌ Invalid auth data from storage event:', saved);
            setAuth(null);
          }
        }
      } catch (error) {
        console.error('[SESSION] ❌ Error parsing auth data from storage event:', error);
        console.log('[SESSION] 🧹 Setting auth to null due to parse error');
        setAuth(null);
      }

      if (typeof onChange === 'function') {
        console.log('[SESSION] 📞 Calling onChange callback');
        onChange();
      }
    }
  });

  console.log('[SESSION] ✅ Auth change listener set up');
}
