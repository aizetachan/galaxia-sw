// server/dm.js
import OpenAI from 'openai';

// --- Configuración LLM ---
// Si hay clave de OpenAI -> usamos OpenAI; si no, fallback a tu LLM OSS (si lo tenías)
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Cliente OpenAI (solo si hay API key)
const openai = hasOpenAI
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Utilidad: construye un prompt compacto con contexto del mundo
function buildSystemPrompt() {
  return [
    'Eres el **Máster** de una aventura ambientada en un universo tipo Star Wars.',
    'Estás moderando un único “mundo vivo” compartido por jugadores.',
    'Estilo: breve, evocador, 2–5 frases por turno. Evita resolver por el jugador.',
    'Nunca reveles tiradas internas. Si una acción depende del mundo, sugiere “Resolver tirada”.',
  ].join('\n');
}

// Reduce el historial a algo corto y útil para el modelo
function compressHistory(history = [], max = 8) {
  const last = history.slice(-max);
  return last
    .map(m => {
      const who = m.kind === 'user' ? (m.user || 'Jugador') : 'Máster';
      return `${who}: ${m.text}`;
    })
    .join('\n');
}

// ---------- API PÚBLICA USADA POR index.js ----------
export async function dmRespond({ history = [], message = '', character = null, world = {} }) {
  const sys = buildSystemPrompt();

  // Contexto del personaje y del mundo (ligero y estable)
  const who =
    character
      ? `Jugador: ${character.name} — ${character.species || '—'} ${character.role || ''}`.trim()
      : 'Jugador: (sin registrar)';
  const loc = character?.lastLocation || 'Ubicación desconocida';

  const worldSnap = (() => {
    try {
      const names = Object.keys(world?.characters || {});
      const evCount = Array.isArray(world?.events) ? world.events.length : 0;
      return `Mundo: ${names.length} personajes, ${evCount} eventos.`;
    } catch { return 'Mundo: —'; }
  })();

  const historyText = compressHistory(history, 8);
  const userTurn = `Mensaje del jugador: ${message}`;

  const fullPrompt = [
    sys,
    '',
    who,
    `Localización actual: ${loc}`,
    worldSnap,
    '',
    'Historial breve:',
    historyText || '(vacío)',
    '',
    userTurn,
    '',
    'Responde como Máster, breve y sugerente. Si la acción es incierta, sugiere “Resolver tirada”.'
  ].join('\n');

  // --- RUTA OPENAI (preferente si hay clave) ---
  if (hasOpenAI) {
    const resp = await openai.responses.create({
      model: OPENAI_MODEL,
      input: fullPrompt,
      // Si quieres streaming en el futuro: stream: true (y adaptar la respuesta)
    });
    const text = resp.output_text?.trim() || '...';
    return text;
  }

  // --- Fallback a tu LLM OSS (si en tu proyecto existía antes) ---
  // Si todavía mantienes variables LLM_BASE_URL/LLM_MODEL en tu backend,
  // aquí podrías llamar a ese servidor. Por ahora devolvemos un mensaje neutro.
  return 'El neón de la cantina parpadea (modo sin OpenAI). ¿Qué haces?';
}

// Narrador de tiradas (se usa desde index.js)
export function narrateOutcome({ outcome, skill, character }) {
  const who = character?.name || 'El aventurero';
  const act = skill ? ` (${skill})` : '';
  if (outcome === 'success') return `${who} supera el obstáculo${act}. La situación avanza a favor.`;
  if (outcome === 'mixed')   return `${who} logra parte de su objetivo${act}, pero surge una complicación clara.`;
  return `${who} falla${act}. El mundo responde con una consecuencia creíble.`;
}
