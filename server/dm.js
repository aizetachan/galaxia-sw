// server/dm.js
import { openai, openaiEnabled } from './openai.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- util para cargar MD empaquetados en Vercel ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPromptAny(candidates) {
  for (const rel of candidates) {
    try {
      const full = path.resolve(__dirname, '..', rel);
      return readFileSync(full, 'utf8');
    } catch {}
  }
  return '';
}

// Acepta nombres antiguos y nuevos, y rutas dentro/fuera de /prompts
const MASTER_MD = readPromptAny([
  'prompts/master.md',
  'prompts/prompt-master.md',
  'prompt-master.md',
]);

const GUIDE_MD = readPromptAny([
  'prompts/guide-rules.md',
  'prompts/game-rules.md',
  'game-rules.md',
]);

const DICE_MD = readPromptAny([
  'prompts/dice-rules.md',
  'dice-rules.md',
]);

// Snippet de respaldo si falta dice-rules.md
const DICE_FALLBACK = `
=== Reglas de tirada (resumen) ===
- Pide tirada sólo si el resultado es incierto, hay oposición o riesgo relevante, o afecta a terceros/entorno.
- Si la tirada es necesaria, inserta literalmente en tu respuesta:
  <<ROLL SKILL="NombreDeHabilidad" REASON="motivo breve">>
  (Ej.: Combate, Fuerza, Carisma, Percepción, Investigación, Sigilo, Movimiento, Juego de manos, Tecnología, Pilotaje, Acción incierta)
- Espera a que el sistema te envíe:
  <<DICE_OUTCOME SKILL="..." OUTCOME="success|mixed|fail">>
  y entonces narra la consecuencia (2–6 frases) y cierra con una pregunta/opción.
- No pidas otra tirada hasta resolver la actual. No pidas tirada para decisiones internas o acciones triviales/obvias sin riesgo.
`.trim();

/* =======================
   Narrador de fallback para /roll
   ======================= */
export function narrateOutcome({ outcome, skill, character }) {
  const who = character?.name || 'Tu personaje';
  const tag = skill ? ` (${skill})` : '';
  if (outcome === 'success') {
    return `${who} actúa con determinación${tag} y el plan sale bien. Describe el detalle: ¿qué logra exactamente?`;
  }
  if (outcome === 'mixed') {
    return `${who} consigue parte de lo que quería${tag}, pero surge una complicación. ¿Aceptas el coste o cambias de rumbo?`;
  }
  return `${who} falla${tag}; algo se interpone. El entorno reacciona. ¿Cómo respondes?`;
}

/* =======================
   Base prompt (DM libre)
   ======================= */
function baseSystemPrompt() {
  const parts = [
    'Eres el Máster de una campaña estilo Star Wars.',
    'Habla en español, tono cercano y cinematográfico. 2–6 frases por turno y termina con una pregunta/opciones.',
    'Responde SIEMPRE en un solo mensaje.',
    'Pide tirada SOLO cuando la acción dependa del mundo/terceros o exista incertidumbre/oposición/riesgo.',
    // Carga de documentos si existen
    MASTER_MD ? `=== Máster ===\n${MASTER_MD}` : '',
    GUIDE_MD  ? `=== Reglas del juego ===\n${GUIDE_MD}`  : '',
    (DICE_MD || DICE_FALLBACK)
      ? `=== Dados ===\n${DICE_MD || DICE_FALLBACK}`
      : '',
    // Recordatorio operativo claro para el modelo
    `Uso de dados:
- Si decides que hay tirada, inserta exactamente: <<ROLL SKILL="..." REASON="...">> (sin explicarlo en texto).
- Tras recibir <<DICE_OUTCOME ...>>, narra según success/mixed/fail y no pidas otra tirada en la misma respuesta.`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

/* =======================
   Chat libre del Máster
   ======================= */
export async function dmRespond({
  history = [],
  message,
  character,
  world,
  stage = 'done',
  intentRequired = false, // ya no lo usamos para UI, pero puede guiar al modelo
  user = null
}) {
  const userMsg = (message || '').trim();
  if (!userMsg) return '¿Qué haces?';

  const system = [
    baseSystemPrompt(),
    `ETAPA:${stage} | intentRequired=${!!intentRequired} | user=${user?.username || 'anon'}`,
    stage !== 'done'
      ? 'En ETAPA distinta de "done" NO pidas tiradas; guía el onboarding de forma amable y diegética.'
      : 'En juego normal, decide si hace falta tirada. Si sí, usa <<ROLL ...>> exactamente una vez.'
  ].join('\n\n');

  // Reducimos contexto
  const shortHistory = history.slice(-6).map(m => ({
    role: m.kind === 'user' ? 'user' : 'assistant',
    content: m.text
  }));

  const worldLine =
    `CTX: char=${character?.name || '—'} (${character?.species || '—'} ${character?.role || '—'})` +
    ` | loc=${character?.lastLocation || '—'} | jugadores=${Object.keys(world?.characters || {}).length}`;

  if (!openaiEnabled) {
    // Respuesta local básica (sin API)
    if (stage !== 'done') {
      return 'Cuando quieras, elige especie válida (Humano, Twi\'lek, Wookiee, Zabrak o Droide) y seguimos.';
    }
    if (/hola|buenas/i.test(userMsg)) {
      return 'La cantina zumba de murmullos y neón. Un droide sirve bebidas; un Rodiano te observa. ¿Qué haces?';
    }
    return 'El HoloNet chisporrotea un segundo, pero vuelve. Mos Eisley te espera. ¿Qué haces?';
  }

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 350,
      messages: [
        { role: 'system', content: system },
        ...shortHistory,
        { role: 'system', content: worldLine },
        { role: 'user', content: userMsg }
      ]
    });
    return resp.choices?.[0]?.message?.content?.trim() || '...';
  } catch (e) {
    console.error('[DM] OpenAI error:', e?.status, e?.message);
    return 'Hay interferencias en la red. Intenta una acción clara o cambia de enfoque.';
  }
}

/* =======================
   Resolución de tirada con IA
   ======================= */
export async function dmResolveRoll({ roll, skill, character, world, user }) {
  // Fallback local si no hay API
  if (!openaiEnabled) {
    const outcome = roll >= 15 ? 'success' : roll >= 8 ? 'mixed' : 'fail';
    return {
      text: narrateOutcome({ outcome, skill, character }),
      outcome,
      summary: outcome === 'success'
        ? `logró su objetivo${skill ? ` (${skill})` : ''}`
        : outcome === 'mixed'
        ? `consiguió algo con complicación${skill ? ` (${skill})` : ''}`
        : `fracasó en el intento${skill ? ` (${skill})` : ''}`
    };
  }

  const system = [
    baseSystemPrompt(),
    '=== Reglas de tirada para esta respuesta ===',
    DICE_MD || DICE_FALLBACK,
    'Devuelve UNA SOLA respuesta narrativa (2–6 frases).',
    'Al final añade la línea: JSON: {"outcome":"success|mixed|fail","summary":"..."}',
  ].join('\n\n');

  const worldLine =
    `CTX: char=${character?.name || '—'} (${character?.species || '—'} ${character?.role || '—'})` +
    ` | loc=${character?.lastLocation || '—'} | jugadores=${Object.keys(world?.characters || {}).length}`;

  const userMsg =
    `TIRADA: d20=${roll} para la acción "${skill || 'Acción'}" de ${character?.name || 'el PJ'}. ` +
    `Narra coherentemente y decide outcome EXACTO según las reglas.`;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 380,
      messages: [
        { role: 'system', content: system },
        { role: 'system', content: worldLine },
        { role: 'user', content: userMsg }
      ]
    });
    const content = resp.choices?.[0]?.message?.content || '';
    const text = content.trim();

    // Parse del tag JSON final
    let outcome = 'mixed';
    let summary = '';
    const m = text.match(/JSON:\s*({.*})\s*$/i);
    if (m) {
      try {
        const j = JSON.parse(m[1]);
        if (j?.outcome) outcome = String(j.outcome);
        if (j?.summary) summary = String(j.summary);
      } catch {}
    }
    if (!summary) {
      summary = outcome === 'success'
        ? `logró su objetivo${skill ? ` (${skill})` : ''}`
        : outcome === 'mixed'
        ? `consiguió algo con complicación${skill ? ` (${skill})` : ''}`
        : `fracasó en el intento${skill ? ` (${skill})` : ''}`;
    }

    const visible = m ? text.replace(m[0], '').trim() : text;
    return { text: visible, outcome, summary };
  } catch (e) {
    console.error('[DM] OpenAI roll error:', e?.status, e?.message);
    const outcome = roll >= 15 ? 'success' : roll >= 8 ? 'mixed' : 'fail';
    return {
      text: narrateOutcome({ outcome, skill, character }),
      outcome,
      summary: outcome === 'success'
        ? `logró su objetivo${skill ? ` (${skill})` : ''}`
        : outcome === 'mixed'
        ? `consiguió algo con complicación${skill ? ` (${skill})` : ''}`
        : `fracasó en el intento${skill ? ` (${skill})` : ''}`
    };
  }
}
