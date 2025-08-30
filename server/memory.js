// server/memory.js
const DEFAULT_TTL_MINUTES = Number(process.env.MEM_TTL_MINUTES ?? 30);
const CLEAN_INTERVAL_MS = Number(process.env.MEM_SWEEP_INTERVAL_MS ?? 60 * 1000);

function createTimedMap(ttlMinutes = DEFAULT_TTL_MINUTES) {
  const ttlMs = ttlMinutes * 60 * 1000;
  const map = new Map();

  function set(key, value) {
    map.set(key, { value, lastAccess: Date.now() });
  }

  function get(key) {
    const entry = map.get(key);
    if (entry) {
      entry.lastAccess = Date.now();
      return entry.value;
    }
    return undefined;
  }

  function has(key) {
    return map.has(key);
  }

  function del(key) {
    map.delete(key);
  }

  function* values() {
    const now = Date.now();
    for (const entry of map.values()) {
      entry.lastAccess = now;
      yield entry.value;
    }
  }

  function cleanup(now = Date.now()) {
    for (const [key, { lastAccess }] of map.entries()) {
      if (now - lastAccess > ttlMs) map.delete(key);
    }
  }

  return { set, get, has, delete: del, values, cleanup };
}

export const mem = {
  users: createTimedMap(),
  sessions: createTimedMap(),
};

export const userLightNotes = createTimedMap();
export const userThreadSummary = createTimedMap();
export const userTurnCount = createTimedMap();

const allMaps = [
  mem.users,
  mem.sessions,
  userLightNotes,
  userThreadSummary,
  userTurnCount,
];

setInterval(() => {
  const now = Date.now();
  for (const m of allMaps) m.cleanup(now);
}, CLEAN_INTERVAL_MS).unref?.();

export function createMemoryMap(ttlMinutes) {
  return createTimedMap(ttlMinutes);
}
