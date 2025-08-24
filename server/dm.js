// server/dm.js
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const hasOpenAI = !!process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const DM_TEMPERATURE = Number(process.env.DM_TEMPERATURE ?? 0.9);
const DM_TOP_P = Number(process.env.DM_TOP_P ?? 0.95);
const DM_MAX_TOKENS = Number(process.env.DM_MAX_TOKENS ?? 280);
const DM_PRESENCE = Number(process.env.DM_PRESENCE ?? 0.2);
const DM_FREQUENCY = Number(process.env.DM_FREQUENCY ?? 0.3);

const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ---- Archivos externos (editables) ----
const PROMPT_FILE = process.env.DM_PROMPT_FILE ||
  path.resolve(process.cwd(), 'server/prompt-master.md');
const RULES_FILE = process.env.DM_RULES_FILE ||
  path.resolve(process.cwd(), 'server/game-rules.md');

function makeHotFileLoader(filePath, maxChars = 16000) {
  let cache = null;
  let mtime = 0;
  return () => {
    try {
      const st = fs.statSync(filePath);
      if (st.mtimeMs !== mtime) {
        let txt = fs.readFileSync(filePath, 'utf8');
        if (txt.length > maxChars) {
          txt = txt.slice(0, maxChars) + '\n\n<!-- trimmed -->';
        }
        cache = txt;
        mtime = st.mtimeMs;
      }
    } catch {
      cache = null;
      mtime = 0;
    }
    return cache;
  };
}

const loadPrompt = makeHotFileLoader(PROMPT_FILE);
const loadRules  = makeHotFileLoader(RULES_FILE);

const safe = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const toShort = (s, n = 160) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

function compressHistory(history = [], max = 10) {
  const last = history.slice(-max);
  return last.map(m => {
    const who = m.kind === 'user' ? (m.user || 'Jugador') : 'Máster';
    return `${who}: ${safe(m.text)}`;
  }).join('\n');
}

function buildWorldContext({ world = {}, character = null, limitEvents = 6 }) {
  const chars = world?.characters || {};
  const events = Array.isArray(world?.events) ? world.events : [];

  const here = character?.lastLocation || '';
  const sameZone = (a, b) => {
    const A = safe((a || '').split('—')[0]).toLowerCase();
    const B = safe((b || '').split('—')[0]).toLowerCase();
    return A && B && A === B;
  };

  const nearby = Object.values(chars)
    .filter(c => c?.name && c?.name !== character?.name && c?.lastLocation && here && sameZone(c.lastLocation, here))
    .slice(0, 5)
    .map(c => `• ${c.name} — ${c.species || '—'} ${c.role || ''} (zona: ${toShort(c.lastLocation, 40)})`);

  const relevant = events
    .filter(e => {
      if (!e) return false;
      if (character?.name && e.actor === character.name) return true;
      if (here && e.location && sameZone(e.location, here)) return true;
      return true;
    })
    .sort((a, b) => (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0))
    .slice(0, limitEvents)
    .map(e => `• ${e.actor} en ${toShort(e.location || 'lugar desconocido', 40)} — ${toShort(e.summary, 70)}`);

  const lines = [];
  if (nearby.length) lines.push('PNJs cercanos:', ...nearby);
  if (relevant.length) lines.push('Últimos sucesos:', ...relevant);
  return lines.join('\n');
}

function baseSystemPrompt() {
  return [
    'Eres el Máster de una aventura tipo Star Wars en un mundo vivo compartido.',
    'Tono: cinematográfico, cercano y evocador. Responde en 2–6 frases naturales.',
    'Describe sensaciones; propone posibilidades sin imponer decisiones.',
    'No menciones mecánicas (dados/tiradas). Si hay incertidumbre, narra riesgos y consecuencias.',
    'Evita muletillas y cierres repetidos; varía los verbos.',
  ].join('\n');
}

function buildSystemPrompt() {
  const ext = loadPrompt();
  const rules = loadRules();
  return [
    baseSystemPrompt(),
    ext ? `\n---\n# Guía del Máster (editable)\n${ext}` : '',
    rules ? `\n---\n# Reglas de Juego (editables)\n${rules}` : '',
  ].join('\n');
}

export async function dmRespond({
  history = [],
  message = '',
  character = null,
  world = {},
  stage = 'done',
  intentRequired = false
}) {
  const sys = buildSystemPrompt();
  const historyText = compressHistory(history, 10);
  const who = character
    ? `Jugador: ${character.name} — ${character.species || '—'} ${character.role || ''}`.trim()
    : 'Jugador: (sin registrar)';
  const loc = character?.lastLocation || 'Ubicación desconocida';

  const worldCtx = buildWorldContext({ world, character, limitEvents: 6 });

  const stageNote =
    stage !== 'done'
      ? `El jugador está en la etapa de creación: "${stage}". Oriéntalo de forma diegética cuando venga al caso, pero responde con normalidad a lo que pregunte.`
      : 'El personaje ya está creado; avanza la ficción.';

  const guardrails = [
    'Responde como Máster en 2–6 frases.',
    intentRequired
      ? 'La acción parece incierta; puedes insinuar riesgo de forma narrativa.'
      : 'No menciones tiradas ni dados.',
  ].join(' ');

  const userPrompt = [
    who,
    `Localización: ${loc}`,
    stageNote,
    worldCtx ? `\nContexto del mundo:\n${worldCtx}` : '',
    '\nHistorial reciente:',
    historyText || '(vacío)',
    '\nMensaje del jugador:',
    safe(message),
    '\n---\n',
    guardrails
  ].join('\n');

  if (hasOpenAI) {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: DM_TEMPERATURE,
      top_p: DM_TOP_P,
      presence_penalty: DM_PRESENCE,
      frequency_penalty: DM_FREQUENCY,
      max_tokens: DM_MAX_TOKENS,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userPrompt }
      ]
    });
    const text = completion.choices?.[0]?.message?.content?.trim()
      || 'El neón chisporrotea sobre la barra. ¿Qué haces?';
    return text;
  }

  return 'El neón de la cantina parpadea (modo sin OpenAI). ¿Qué haces?';
}

export function narrateOutcome({ outcome, skill, character }) {
  const who = character?.name || 'El aventurero';
  const act = skill ? ` (${skill})` : '';
  if (outcome === 'success') return `${who} supera el obstáculo${act}. La situación avanza a favor.`;
  if (outcome === 'mixed')   return `${who} logra parte de su objetivo${act}, pero surge una complicación clara.`;
  return `${who} falla${act}. El mundo responde con una consecuencia creíble.`;
}
