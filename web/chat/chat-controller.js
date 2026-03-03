import { load, save, KEY_MSGS } from "../auth/session.js";
import { dlog } from "../api.js";

export let msgs = load(KEY_MSGS, []);
export let pendingRoll = null;

let renderCb = null;
export function setRenderCallback(fn){ renderCb = fn; }

export function setMsgs(list){
  msgs = Array.isArray(list) ? list : [];
}

export function setPendingRoll(v){ pendingRoll = v; }

export function resetMsgs(){
  msgs = [];
  save(KEY_MSGS, msgs);
  renderCb?.();
}

function now(){ return Date.now(); }

export function pushDM(text){
  msgs = [...msgs, { user: 'Máster', text, kind: 'dm', ts: now() }];
  save(KEY_MSGS, msgs);
  renderCb?.();
}

export function pushUser(text, character){
  msgs = [...msgs, { user: character?.name || 'Tú', text, kind: 'user', ts: now() }];
  save(KEY_MSGS, msgs);
  renderCb?.();
}

function tryParseJson(s){ try { return JSON.parse(s); } catch { return null; } }
function extractTopMeta(txt = '') {
  let rest = String(txt || '');
  const fenced = rest.match(/^```json\s*\n([\s\S]*?)\n```/i);
  if (fenced) {
    const meta = tryParseJson(fenced[1]);
    if (meta) return { meta, rest: rest.slice(fenced[0].length).trim() };
  }
  const firstLineObj = rest.match(/^\s*\{[\s\S]*?\}\s*(?:\n|$)/);
  if (firstLineObj) {
    const meta = tryParseJson(firstLineObj[0]);
    if (meta) return { meta, rest: rest.slice(firstLineObj[0].length).trim() };
  }
  return { meta: null, rest };
}

function stripProtoTags(s = '') {
  return String(s).replace(/<<[\s\S]*?>>/g, '');
}

function looksLikeMetaObject(v){
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v).map(k => k.toLowerCase());
  const known = ['roll','memo','options','resume','stage','debug','meta','tags','system'];
  return keys.some(k => known.includes(k));
}

function stripLeadingMetaNoise(input = '') {
  let txt = String(input || '');
  for (let i = 0; i < 4; i++) {
    const before = txt;
    const fenced = txt.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*/i);
    if (fenced) {
      const parsed = tryParseJson(fenced[1]);
      if (parsed && (looksLikeMetaObject(parsed) || i === 0)) txt = txt.slice(fenced[0].length);
    }

    const leadObj = txt.match(/^\s*\{[\s\S]*?\}\s*(?:\n+|$)/);
    if (leadObj) {
      const parsed = tryParseJson(leadObj[0]);
      if (parsed && looksLikeMetaObject(parsed)) txt = txt.slice(leadObj[0].length);
    }

    txt = txt
      .replace(/^\s*(?:<<[\s\S]*?>>\s*)+/g, '')
      .replace(/^\s*\[(?:meta|system|debug)\][^\n]*\n?/i, '')
      .replace(/^\s*<(?:meta|system|debug)[^>]*>\s*/i, '');

    if (txt === before) break;
  }
  return txt.trim();
}

export function cleanDMText(rawText){
  const stripped = stripLeadingMetaNoise(String(rawText || ''));
  return stripProtoTags(stripped).trim();
}

export function handleIncomingDMText(rawText){
  let txt = String(rawText || '');
  pendingRoll = null;

  let meta = null;
  const { meta: m, rest } = extractTopMeta(txt);
  if (m) { meta = m; txt = rest; }

  if (meta) {
    if (typeof meta.roll === 'string' && meta.roll && meta.roll.toLowerCase() !== 'null') {
      const [skill, dc] = String(meta.roll).split(':');
      pendingRoll = { skill: (skill || 'Acción').trim(), dc: dc ? Number(dc) : null };
    }
    if (Array.isArray(meta.memo) && meta.memo.length) {
      const prev = load('sw:scene_memo', []);
      save('sw:scene_memo', [...prev, ...meta.memo].slice(-10));
    }
    if (Array.isArray(meta.options) && meta.options.length) {
      txt += (txt ? '\n\n' : '') + 'Sugerencias: ' + meta.options.map(o => `“${o}”`).join(' · ');
    }
    if (typeof meta.resume === 'string' && meta.resume) {
      save('sw:last_resume', meta.resume);
    }
  }

  const rollTag = txt.match(/<<ROLL\s+SKILL="([^"]+)"(?:\s+REASON="([^"]*)")?\s*>>/i);
  if (rollTag) {
    const [, skill, reason] = rollTag;
    pendingRoll = { ...(pendingRoll || {}), skill: skill.trim(), ...(reason ? { reason: reason.trim() } : {}) };
    txt = txt.replace(rollTag[0], '').trim();
  }

  txt = cleanDMText(txt);

  if (txt) pushDM(txt);
}

export function mapStageForDM(s) { if (s === 'species' || s === 'role') return 'build'; return s || 'name'; }

export async function talkToDM(api, message, step, character, pendingConfirm, getClientState, getDmMode){
  dlog('talkToDM start', { message, step, character, pendingConfirm });
  try {
    const hist = msgs.slice(-8);
    const res = await api('/dm/respond', {
      message,
      history: hist,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState(),
      config: { mode: getDmMode() }
    });
    handleIncomingDMText(res.text);
  } catch (e) {
    dlog('talkToDM error:', e?.data || e);
    pushDM('El canal se llena de estática. Intenta de nuevo en un momento.');
  }
}
