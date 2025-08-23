import 'dotenv/config';

const BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
const MODEL = process.env.LLM_MODEL || 'llama3.1';
const API_KEY = process.env.LLM_API_KEY || '';

export async function callLLM(messages, opts = {}) {
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {})
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: opts.temperature ?? 0.9,
        max_tokens: opts.max_tokens ?? 300,
        messages
      })
    });
    if (!res.ok) throw new Error(`LLM error ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.error('callLLM error', e);
    return null;
  }
}

const SYSTEM_PROMPT = `Eres el Máster de una aventura conversacional ambientada en Star Wars.
- Responde SIEMPRE en español neutral con tono descriptivo y cinematográfico (5-10 líneas).
- Sitúa escenas y elementos propios: luz de neón, droides, patrullas imperiales, Hutt.
- No menciones números de dados ni reglas, solo historia.
- Acepta definiciones del jugador sobre su personaje y continúa con un empujón narrativo.
- Evita reproducir diálogos con copyright literal; crea contenido original inspirado.
`;

export async function dmRespond({ history, message, character, world }) {
  const mapped = (history || []).map(m => ({
    role: m.kind === 'dm' ? 'assistant' : 'user',
    content: m.text
  })).slice(-10);

  const worldHint = buildWorldHint(world);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + '\n' + worldHint },
    ...mapped,
    { role: 'user', content: message }
  ];

  const llmText = await callLLM(messages);
  if (llmText) return llmText;
  return `El neón de la cantina parpadea mientras consideras tu siguiente paso. Un droide de protocolo se detiene y te observa. ¿Observas, preguntas o te mueves?`;
}

export function narrateOutcome({ outcome, skill, character }) {
  const who = character?.name ? `**${character.name}**` : 'Tu personaje';
  const suffix = skill ? ` (${skill})` : '';
  if (outcome === 'success') return `${who} logra su objetivo${suffix}. La escena avanza a tu favor.`;
  if (outcome === 'mixed')   return `${who} consigue parte de lo que busca${suffix}, pero surge una complicación.`;
  return `${who} falla${suffix}. Algo se interpone.`;
}

function buildWorldHint(world) {
  if (!world) return '';
  const chars = Object.values(world.characters || {});
  const lastEvt = [...(world.events || [])].slice(-3).map(e => `- ${e.actor} en ${e.location}: ${e.summary}`);
  const who = chars.length ? `Jugadores activos: ${chars.map(c => `${c.name} (${c.role})`).join(', ')}` : 'Sin jugadores activos aún.';
  const ev = lastEvt.length ? `Últimos eventos HoloNet:\n${lastEvt.join('\n')}` : 'Sin eventos recientes.';
  return `Contexto del mundo compartido:\n${who}\n${ev}`;
}
