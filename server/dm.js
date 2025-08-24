// server/dm.js
import { openai, openaiEnabled } from './openai.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* =======================
   Utils
   ======================= */
function rollDice(sides = 20) {
  const n = Number.isFinite(sides) && sides >= 2 ? Math.floor(sides) : 20;
  try { return crypto.randomInt(n) + 1; }       // 1..n (Node 16+)
  catch { return 1 + Math.floor(Math.random() * n); }
}
function loadTextSafe(relPath) {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(__dirname, '..'); // repo root = carpeta padre de /server
    const full = path.join(root, relPath);
    return fs.readFileSync(full, 'utf8');
  } catch { return null; }
}

/* =======================
   NARRADOR (tiradas)
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
  return `${who} falla${tag}; algo se interpone. El entorno reacciona: ruido, miradas, puertas que se cierran. ¿Cómo respondes?`;
}

/* =======================
   DM con OpenAI
   ======================= */

// Prompt mínimo de sistema. Si existen los .md, se añaden como mensajes de sistema aparte.
function baseSystemPrompt() {
  return [
    'Eres el Máster de una campaña estilo Star Wars.',
    'Habla en español, tono cercano y cinematográfico.',
    'Responde SIEMPRE en un solo mensaje (conciso y jugable).',
    // Política mínima del dado:
    'Cuando una acción tenga resultado incierto o consecuencias fuera del control del jugador, usa el tool `dice.roll` (d20 por defecto).',
    'No inventes números de tirada; narra las consecuencias en base a las tablas/reglas proporcionadas en el contexto.',
    'Guía a quien llega por primera vez: explica breve cómo empezar si detectas que no tiene personaje o está en onboarding.'
  ].join('\n');
}

// Respuesta de emergencia cuando no hay OpenAI o se cae la llamada
function fallbackReply({ message, stage }) {
  const m = (message || '').toLowerCase();
  if (stage !== 'done') {
    return 'Cuando quieras, elige especie válida (Humano, Twi\'lek, Wookiee, Zabrak o Droide) y seguimos.';
  }
  if (/hola|buenas/.test(m)) {
    return 'La cantina zumba de murmullos y neón. Un droide sirve bebidas; un Rodiano te observa. ¿Qué haces?';
  }
  return 'El canal crepita un segundo, pero el HoloNet vuelve: estás en Mos Eisley. Marca tu intención y jugamos.';
}

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

  // Construimos contexto
  const system = baseSystemPrompt() +
    `\n\n[ETAPA:${stage}] intentRequired=${!!intentRequired} user=${user?.username || 'anon'}`;

  const shortHistory = history.slice(-6).map(m => ({
    role: m.kind === 'user' ? 'user' : 'assistant',
    content: m.text
  }));

  const worldLine =
    `CTX: char=${character?.name || '—'}(${character?.species || '—'} ${character?.role || '—'})` +
    ` | loc=${character?.lastLocation || '—'} | jugadores=${Object.keys(world?.characters || {}).length}`;

  // Cargamos reglas/prompts en markdown si existen (no son obligatorios)
  const masterMd = loadTextSafe('prompt-master.md');  // raíz del repo
  const rulesMd  = loadTextSafe('game-rules.md');     // raíz del repo

  // Si no hay API key, contestamos con fallback
  if (!openaiEnabled) {
    console.warn('[DM] OpenAI deshabilitado (sin OPENAI_API_KEY).');
    return fallbackReply({ message: userMsg, stage });
  }

  // Tool mínimo: dado que devuelve solo un número
  const tools = [{
    type: 'function',
    function: {
      name: 'dice.roll',
      description: 'Tira un dado y devuelve únicamente el número obtenido.',
      parameters: {
        type: 'object',
        properties: {
          sides: { type: 'integer', minimum: 2, description: 'Número de caras (por defecto 20).' }
        }
      }
    }
  }];

  // Mensajes iniciales
  const messages = [
    { role: 'system', content: system },
    ...(masterMd ? [{ role: 'system', content: masterMd }] : []),
    ...(rulesMd  ? [{ role: 'system', content: rulesMd  }] : []),
    ...shortHistory,
    { role: 'system', content: worldLine },
    { role: 'user', content: userMsg }
  ];

  try {
    const t0 = Date.now();

    // 1ª pasada: el Máster decide si necesita tirar (tool_call automático)
    let resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 350,
      messages,
      tools,
      tool_choice: 'auto'
    });

    let msg = resp.choices?.[0]?.message;

    // Si pidió tirar el dado, lo resolvemos aquí mismo y hacemos 2ª pasada
    const call = msg?.tool_calls?.find(tc => tc.function?.name === 'dice.roll');
    if (call) {
      const args = JSON.parse(call.function.arguments || '{}');
      const sides = args.sides || 20;
      const result = rollDice(sides);

      messages.push(msg);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: 'dice.roll',
        content: JSON.stringify({ result, sides })
      });

      resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 350,
        messages
      });
      msg = resp.choices?.[0]?.message;
    }

    const text = msg?.content?.trim();
    console.log(`[DM] OpenAI ok id=${resp.id} ${Date.now() - t0}ms tokens=${resp.usage?.total_tokens ?? '?'} stage=${stage}`);
    return text || '...';
  } catch (e) {
    console.error('[DM] OpenAI error:', {
      status: e?.status,
      message: e?.message,
      code: e?.code,
      type: e?.error?.type,
    });
    return fallbackReply({ message: userMsg, stage });
  }
}
