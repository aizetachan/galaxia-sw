// server/dm.js
import { openai, openaiEnabled } from './openai.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- util para cargar MD empaquetados en Vercel ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function readPrompt(rel) {
  try {
    return readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  } catch { return ''; }
}

// Carga tus prompts (ajusta rutas si los mueves)
const MASTER_MD = readPrompt('prompts/master.md');        // opcional pero recomendado
const GUIDE_MD  = readPrompt('prompts/guide-rules.md');   // opcional pero recomendado
const DICE_MD   = readPrompt('prompts/dice-rules.md');    // <- NUEVO

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
  return [
    'Eres el Máster de una campaña estilo Star Wars.',
    'Habla en español, tono cercano y cinematográfico.',
    'Responde SIEMPRE en un solo mensaje (conciso y jugable).',
    'No pidas tirar dados salvo que la acción dependa del mundo (incertidumbre).',
    MASTER_MD ? `=== Máster ===\n${MASTER_MD}` : '',
    GUIDE_MD  ? `=== Reglas ===\n${GUIDE_MD}`  : '',
  ].filter(Boolean).join('\n\n');
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
  intentRequired = false,
  user = null
}) {
  const userMsg = (message || '').trim();
  if (!userMsg) return '¿Qué haces?';

  const system = baseSystemPrompt() +
    `\n\n[ETAPA:${stage}] intentRequired=${!!intentRequired} user=${user?.username || 'anon'}`;

  const shortHistory = history.slice(-6).map(m => ({
    role: m.kind === 'user' ? 'user' : 'assistant',
    content: m.text
  }));

  const worldLine =
    `CTX: char=${character?.name || '—'}(${character?.species || '—'} ${character?.role || '—'})` +
    ` | loc=${character?.lastLocation || '—'} | jugadores=${Object.keys(world?.characters || {}).length}`;

  if (!openaiEnabled) {
    // Respuesta local básica
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
    '=== Reglas de tirada ===',
    DICE_MD || 'Usa d20 y decide success/mixed/fail según el número.',
    'Devuelve UNA SOLA respuesta narrativa.',
    'Al final añade la línea: JSON: {"outcome":"success|mixed|fail","summary":"..."}',
  ].join('\n\n');

  const worldLine =
    `CTX: char=${character?.name || '—'}(${character?.species || '—'} ${character?.role || '—'})` +
    ` | loc=${character?.lastLocation || '—'} | jugadores=${Object.keys(world?.characters || {}).length}`;

  const userMsg =
    `TIRADA: d20=${roll} para la acción "${skill || 'Acción'}" de ${character?.name || 'el PJ'}. ` +
    `Decide el resultado EXACTAMENTE según las reglas de tirada y narra en 3–5 líneas como máximo.`;

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
    // Si el modelo no puso JSON correctamente, estimamos outcome por el número
    if (!summary) {
      summary = outcome === 'success'
        ? `logró su objetivo${skill ? ` (${skill})` : ''}`
        : outcome === 'mixed'
        ? `consiguió algo con complicación${skill ? ` (${skill})` : ''}`
        : `fracasó en el intento${skill ? ` (${skill})` : ''}`;
    }

    // Quita el rastro JSON de la narración mostrada al jugador
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
