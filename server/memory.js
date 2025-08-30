export const LIGHT_NOTES_MAX = 20;
export const THREAD_SUMMARY_MAX_LEN = 1000;
export const SUMMARY_EVERY_TURNS = Number(process.env.SUMMARY_EVERY_TURNS ?? 6);
export const SUMMARY_HISTORY_TRIGGER = Number(process.env.SUMMARY_HISTORY_TRIGGER ?? 40);

class TimedMap extends Map {
  constructor(ttlMs = 1000 * 60 * 60) {
    super();
    this.ttlMs = ttlMs;
    this.timestamps = new Map();

    const interval = setInterval(() => this.cleanup(), ttlMs);
    interval.unref?.();
  }

  set(key, value) {
    this.timestamps.set(key, Date.now());
    return super.set(key, value);
  }

  delete(key) {
    this.timestamps.delete(key);
    return super.delete(key);
  }

  clear() {
    this.timestamps.clear();
    return super.clear();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, time] of this.timestamps) {
      if (now - time > this.ttlMs) {
        this.timestamps.delete(key);
        super.delete(key);
      }
    }
  }
}

export function createTimedMap(ttlMs) {
  return new TimedMap(ttlMs);
}

export const userLightNotes = createTimedMap();
export const userThreadSummary = createTimedMap();
export const userTurnCount = createTimedMap();

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
