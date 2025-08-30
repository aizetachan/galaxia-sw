export const LIGHT_NOTES_MAX = 20;
export const THREAD_SUMMARY_MAX_LEN = 1000;
export const SUMMARY_EVERY_TURNS = Number(
  process.env.SUMMARY_EVERY_TURNS ?? 6,
);
export const SUMMARY_HISTORY_TRIGGER = Number(
  process.env.SUMMARY_HISTORY_TRIGGER ?? 40,
);

function createTimedMap(ttlMs = 1000 * 60 * 60 * 4) {
  const data = new Map();
  const expires = new Map();

  function del(key) {
    data.delete(key);
    expires.delete(key);
  }

  return {
    set(key, value, ttl = ttlMs) {
      data.set(key, value);
      expires.set(key, Date.now() + ttl);
      return value;
    },
    get(key) {
      const exp = expires.get(key);
      if (exp && exp <= Date.now()) {
        del(key);
        return undefined;
      }
      return data.get(key);
    },
    delete: del,
    cleanup() {
      const now = Date.now();
      for (const [key, exp] of expires.entries()) {
        if (exp <= now) del(key);
      }
    },
  };
}

export const mem = createTimedMap();

export const userLightNotes = new Map();
export const userThreadSummary = new Map();
export const userTurnCount = new Map();

export function getNotes(userId) {
  return userLightNotes.get(userId) || [];
}

export function setNotes(userId, notes) {
  userLightNotes.set(userId, [...notes].slice(-LIGHT_NOTES_MAX));
}

export function getSummary(userId) {
  return userThreadSummary.get(userId) || '';
}

export function setSummary(userId, text) {
  const t = String(text || '').slice(-THREAD_SUMMARY_MAX_LEN);
  userThreadSummary.set(userId, t);
}

export function bumpTurns(userId) {
  const n = (userTurnCount.get(userId) || 0) + 1;
  userTurnCount.set(userId, n);
  return n;
}

setInterval(() => mem.cleanup(), 1000 * 60);
