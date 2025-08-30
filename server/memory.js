export const LIGHT_NOTES_MAX = 20;
export const THREAD_SUMMARY_MAX_LEN = 1000;
export const SUMMARY_EVERY_TURNS = Number(process.env.SUMMARY_EVERY_TURNS ?? 6);
export const SUMMARY_HISTORY_TRIGGER = Number(process.env.SUMMARY_HISTORY_TRIGGER ?? 40);

const userLightNotes = new Map();
const userThreadSummary = new Map();
const userTurnCount = new Map();

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
