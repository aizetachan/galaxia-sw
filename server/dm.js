// server/dm.js
import OpenAI from 'openai';

// ================== Config ==================
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// “Tacto” del Máster (puedes ajustarlo sin tocar código)
const DM_TEMPERATURE = Number(process.env.DM_TEMPERATURE ?? 0.9);
const DM_TOP_P = Number(process.env.DM_TOP_P ?? 0.95);
const DM_MAX_TOKENS = Number(process.env.DM_MAX_TOKENS ?? 280);
// Penalizaciones suaves para evitar muletillas repetidas
const DM_PRESENCE = Number(process.env.DM_PRESENCE ?? 0.2);
const DM_FREQUENCY = Number(process.env.DM_FREQUENCY ?? 0.3);

// Cliente OpenAI (solo si hay API key)
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ================== Helpers ==================
const safeText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const toShort = (s, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Historial compacto (rol + texto)
function compressHistory(history = [], max = 10) {
  const last = history.slice(-max);
  return last
    .map(m => {
      const who = m.kind === 'user' ? (m.user || 'Jugador') : 'Máster';
      return `${who}: ${safeText(m.text)}`;
    })
    .join('\n');
}

// Contexto del mundo: PNJs cercanos + últimos eventos
function buildWorldContext({ world = {}, character = null, limitEvents = 6 }) {
  const chars = world?.characters || {};
  const events = Array.isArray(world?.events) ? world.events : [];

  const here = character?.lastLocation || '';
  const sameZone = (a, b) => {
    const A = safeText(a.split('—')[0]).toLowerCase();
    const B = safeText(b.split('—')[0]).toLowerCase();
    return A && B && A === B;
  };

  // PNJs visibles (misma zona)
  const nearby = Object.values(chars)
    .filter(c => c?.name && c?.name !== character?.name && c?.lastLocation && here && sameZone(c.lastLocation, here))
    .slice(0, 5)
    .map(c => `• ${c.name} — ${c.species || '—'} ${c.role || ''} (zona: ${toShort(c.lastLocation, 40)})`);

  // Últimos eventos relevantes (propios, de la zona, o generales)
  const relevant = events
    .filter(e => {
      if (!e) return false;
      if (character?.name && e.actor === character.name) return true;
      if (here && e.location && sameZone(e.location, here)) return true;
      return true; // dejamos algo de “ruido mundo” para sabor
    })
    .sort((a, b) => (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0))
    .slice(0, limitEvents)
    .map(e => `• ${e.actor} en ${toShort(e.location || 'lugar desconocido', 40)} — ${toShort(e.summary, 70)}`);

  const lines = [];
  if (nearby.length) {
    lines.push('PNJs cercanos:', ...nearby);
  }
  if (relevant.length) {
    lines.push('Últimos sucesos:', ...relevant);
  }
  return lines.join('\n');
}

// “Biblia” breve del Máster: estilo y reglas suaves (no rígidas)
function buildSystemPrompt() {
  return [
    'Eres el **Máster** de una aventura tipo Star Wars en un “mundo vivo” compartido.',
    'Tono: cinematográfico, cercano y evocador. 2–6 frases por turno, con ritmo.',
    'Da descripciones sensoriales y opciones sugerentes, no órdenes.',
    'No hables de “tiradas” salvo que el jugador lo pida; el sistema de dados lo gestiona la app.',
    'No inventes reglas técnicas; improvisa narrativa coherente con el contexto.',
    'Evita repetir fórmulas; varía verbos y construcciones.',
    'No resuelvas decisiones por el jugador: plantea consecuencias creíbles.',
  ].join('\n');
}

// ================== API usada por index.js ==================
export async function dmRespond({
  history = [],
  message = '',
  character = null,
  world = {},
  // En el futuro, si quieres que el Máster aluda a una tirada, pasa true desde el front:
  intentRequired = false
}) {
  const sys = buildSystemPrompt();
  const historyText = compressHistory(history, 10);
  const who = character
    ? `Jugador: ${character.name} — ${character.species || '—'} ${character.role || ''}`.trim()
    : 'Jugador: (sin registrar)';
  const loc = character?.lastLocation || 'Ubicación desconocida';

  const worldCtx = buildWorldContext({ world, character, limitEvents: 6 });

  // “Guía de respuesta” para el turno actual
  const guardrails = [
    'Responde como Máster en 2–6 frases, naturales y sin listas.',
    'Puedes ofrecer 1–2 posibles líneas de acción, pero sin forzar.',
    'Si el jugador hace una acción imposible, reencuadra con consecuencia creíble.',
    intentRequired
      ? 'La acción parece incierta; puedes insinuar que el sistema resolverá el riesgo.'
      : 'No menciones tiradas ni dados; céntrate en ficción.'
  ].join(' ');

  const userPrompt = [
    who,
    `Localización: ${loc}`,
    worldCtx ? `\nContexto del mundo:\n${worldCtx}` : '',
    '\nHistorial reciente:',
    historyText || '(vacío)',
    '\nMensaje del jugador:',
    safeText(message),
    '\n---\n',
    guardrails
  ].join('\n');

  // =========== Ruta OpenAI (preferente) ===========
  if (hasOpenAI) {
    // Usamos Chat Completions para tener mensajes separados (mejor que un “mega-string”)
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: DM_TEMPERATURE,
      top_p: DM_TOP_P,
      presence_penalty: DM_PRESENCE,
      frequency_penalty: DM_FREQUENCY,
      max_tokens: DM_MAX_TOKENS,
      messages: [
        { role: 'system', content: sys },
        // Podrías inyectar un “developer” con la biblia del setting si crece
        { role: 'user', content: userPrompt }
      ]
    });

    const text =
      completion.choices?.[0]?.message?.content?.trim() ||
      'El neón chisporrotea sobre la barra. ¿Qué haces?';
    return text;
  }

  // =========== Fallback si no hay OpenAI ===========
  return 'El neón de la cantina parpadea (modo sin OpenAI). ¿Qué haces?';
}

// Se mantiene igual para index.js
export function narrateOutcome({ outcome, skill, character }) {
  const who = character?.name || 'El aventurero';
  const act = skill ? ` (${skill})` : '';
  if (outcome === 'success') return `${who} supera el obstáculo${act}. La situación avanza a favor.`;
  if (outcome === 'mixed')   return `${who} logra parte de su objetivo${act}, pero surge una complicación clara.`;
  return `${who} falla${act}. El mundo responde con una consecuencia creíble.`;
}
