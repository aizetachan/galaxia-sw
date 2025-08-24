// server/dm.js
import { openai, openaiEnabled } from './openai.js';

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

// Prompt mínimo de sistema (sustituye por tu lectura de /prompts/master.md + /prompts/guide-rules.md si quieres)
function baseSystemPrompt() {
  return [
    'Eres el Máster de una campaña estilo Star Wars.',
    'Habla en español, tono cercano y cinematográfico.',
    'Responde SIEMPRE en un solo mensaje (conciso y jugable).',
    'No pidas tirar dados salvo que la acción dependa del mundo (incertidumbre).',
    'Guía a quien llega por primera vez: explica breve cómo empezar si detectas que no tiene personaje o está en onboarding.',
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

  // Si no hay API key, contestamos con fallback (evita 500 y bucles de "estática")
  if (!openaiEnabled) {
    console.warn('[DM] OpenAI deshabilitado (sin OPENAI_API_KEY).');
    return fallbackReply({ message: userMsg, stage });
  }

  try {
    const t0 = Date.now();
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
    const text = resp.choices?.[0]?.message?.content?.trim();
    console.log(`[DM] OpenAI ok id=${resp.id} ${Date.now() - t0}ms tokens=${resp.usage?.total_tokens ?? '?'} stage=${stage}`);
    return text || '...';
  } catch (e) {
    console.error('[DM] OpenAI error:', {
      status: e?.status,
      message: e?.message,
      code: e?.code,
      type: e?.error?.type,
    });
    // Fallback elegante si la llamada falla
    return fallbackReply({ message: userMsg, stage });
  }
}
