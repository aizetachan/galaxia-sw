// server/openai.js
import OpenAI from 'openai';

const apiKey = (process.env.OPENAI_API_KEY || '').trim();
const project = (process.env.OPENAI_PROJECT || '').trim() || undefined;

export const openaiEnabled = !!apiKey;

export const openai = openaiEnabled
  ? new OpenAI({ apiKey, project })
  : null;

// Ping sencillo para debug: lista un modelo o hace un mini completion
export async function pingOpenAI() {
  if (!openaiEnabled) return { ok: false, error: 'NO_API_KEY' };
  try {
    const t0 = Date.now();
    // llamada mínima para verificar conectividad/credenciales
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 4,
    });
    return { ok: true, id: resp.id, latency_ms: Date.now() - t0 };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'OPENAI_ERROR',
      status: e?.status,
    };
  }
}
