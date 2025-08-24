// server/dm.js
import { openai, openaiEnabled } from './openai.js';

// Si tienes ficheros .md, cárgalos aquí (sync al arrancar o lazy en cada request)
// import fs from 'fs';
// const PROMPT_MASTER = fs.readFileSync('prompts/master.md','utf8');
// const GUIDE_RULES   = fs.readFileSync('prompts/guide-rules.md','utf8');

function baseSystemPrompt() {
  // Pon aquí un prompt mínimo para probar (sustitúyelo por tu PROMPT_MASTER + GUIDE_RULES)
  return [
    "Eres el Máster de una partida ambientada en Star Wars.",
    "Habla en español, con tono cercano y cinematográfico.",
    "Contesta en un solo mensaje; no pidas tirar dados salvo que haya acción incierta."
  ].join('\n');
}

export async function dmRespond({ history = [], message, character, world, stage = 'done', intentRequired = false, user = null }) {
  // Fallbacks RÁPIDOS si no hay API o no hay mensaje
  if (!message || !message.trim()) return '¿Qué haces?';
  if (!openaiEnabled) {
    console.warn('[DM] OpenAI deshabilitado (sin OPENAI_API_KEY). Usando fallback.');
    return 'El canal se llena de estática. (OpenAI no configurado).';
  }

  // Construimos el contexto mínimo para probar (ajústalo a tu formato)
  const system = baseSystemPrompt() +
    `\n\n[ETAPA:${stage}] intentRequired=${intentRequired} user=${user?.username || 'anon'}`;

  const messages = [
    { role: 'system', content: system },
    // si quieres, pasa parte del histórico real
    ...history.slice(-6).map(m => ({
      role: m.kind === 'user' ? 'user' : 'assistant',
      content: m.text
    })),
    // estado del personaje/mundo en una única línea para que el modelo lo use si quiere
    {
      role: 'system',
      content: `CTX: character=${character?.name || '—'}(${character?.species || '—'} ${character?.role || '—'}), loc=${character?.lastLocation || '—'}`
    },
    { role: 'user', content: message }
  ];

  try {
    const t0 = Date.now();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',        // usa el que prefieras
      messages,
      temperature: 0.7,
      max_tokens: 350,
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    console.log(`[DM] OpenAI ok id=${resp.id} ${Date.now() - t0}ms tokens=${resp.usage?.total_tokens || '?'} stage=${stage}`);
    return text || '...';
  } catch (e) {
    // Log detallado para detectar por qué no llega al dashboard
    console.error('[DM] OpenAI error:', {
      status: e?.status,
      message: e?.message,
      code: e?.code,
      type: e?.error?.type,
    });
    return 'El canal se llena de estática. (Fallo al contactar con el oráculo).';
  }
}
