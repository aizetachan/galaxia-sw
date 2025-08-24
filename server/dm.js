// server/dm.js
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Carga y cachea prompts
let PROMPT_MASTER = '';
let GUIDE_RULES = '';

async function loadPrompts() {
  if (PROMPT_MASTER && GUIDE_RULES) return;
  const here = path.dirname(new URL(import.meta.url).pathname);
  const pmPath = path.join(here, 'prompts', 'prompt-master.md');
  const grPath = path.join(here, 'prompts', 'guide-rules.md');

  try { PROMPT_MASTER = await fs.readFile(pmPath, 'utf8'); }
  catch { PROMPT_MASTER = '# Máster\nResponde como un director de juego de Star Wars.\n'; }

  try { GUIDE_RULES = await fs.readFile(grPath, 'utf8'); }
  catch { GUIDE_RULES = '- Mantén el tono cinematográfico.\n- Explica con suavidad al inicio cómo empezar.\n'; }
}

function toBriefWorld(world = {}) {
  const chars = Object.values(world.characters || {})
    .map(c => `- ${c.name} (${c.species || '—'} ${c.role || ''}) — ${c.lastLocation || 'Paradero desconocido'}`)
    .join('\n');
  return `## Resumen del mundo
Personajes:
${chars || '—'}

Registros recientes: ${Array.isArray(world.events) ? world.events.length : 0} eventos.`;
}

function formatHistory(history = []) {
  // history es el array de msgs que pintas en el front; lo reducida un poco
  return history.slice(-8).map(m => {
    const role = (m.kind === 'user') ? 'user' : 'assistant';
    return { role, content: `[${m.user}] ${m.text}` };
  });
}

// Fallback muy básico si no hay API: evita las “respuestas por defecto”
function localFallback({ stage, character, message }) {
  const name = character?.name || 'viajer@';
  if (stage !== 'done') {
    if (stage === 'name') {
      return `Bienvenid@ al HoloCanal. Dime tu **nombre** para registrar tu identidad en la red.`;
    }
    if (stage === 'species') {
      return `Perfecto, ${name}. Elige **especie** (Humano, Twi'lek, Wookiee, Zabrak o Droide) y te situaré en la escena.`;
    }
    if (stage === 'role') {
      return `${name}, ¿qué **rol** asumes? (Piloto, Contrabandista, Jedi, Cazarrecompensas o Ingeniero).`;
    }
  }
  // Conversación libre
  return `La holopantalla carga lentamente. Te escucho: "${message}". ¿Qué haces a continuación?`;
}

export async function dmRespond({ history = [], message = '', character = null, world = {}, stage = 'done', intentRequired = false, user = null }) {
  await loadPrompts();

  const worldBrief = toBriefWorld(world);
  const charBrief = character ? `\n## Personaje del jugador\nNombre: ${character.name}\nEspecie: ${character.species || '—'}\nRol: ${character.role || '—'}\nPerfil público: ${character.publicProfile ? 'Sí' : 'No'}\nUbicación: ${character.lastLocation || '—'}` : '\n## Personaje del jugador\n— (aún sin registrar)';

  const notLogged = !user; // usuario aún no autenticado

  // Construimos el system combinando tus .md con contexto
  const system = [
    'Eres el **Máster** (director de juego) de una experiencia de rol ambientada en el universo de Star Wars.',
    'Responde SIEMPRE en **español** y en **una sola respuesta** por turno.',
    'Evita listas largas; usa 2–3 frases narrativas y una pregunta o propuesta clara.',
    'Si el jugador intenta una acción incierta, puedes sugerir una tirada, pero no forces. Menciona el tipo brevemente.',
    '',
    '--- PROMPT MASTER ---',
    PROMPT_MASTER.trim(),
    '',
    '--- GAME RULES ---',
    GUIDE_RULES.trim(),
    '',
    '--- CONTEXTO EJECUCIÓN ---',
    `Estado del flujo (stage): ${stage}`,
    `Requiere tirada (heurística UI): ${intentRequired ? 'sí' : 'no'}`,
    `Usuario autenticado: ${notLogged ? 'no' : 'sí'}`,
    charBrief,
    worldBrief,
  ].join('\n');

  const msgs = [
    { role: 'system', content: system },
    ...formatHistory(history),
    { role: 'user', content: message || '...' }
  ];

  // Si no hay API KEY, devolvemos localFallback (sin “respuestas por defecto” rígidas)
  if (!openai) {
    return localFallback({ stage, character, message });
  }

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      messages: msgs,
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    return text || localFallback({ stage, character, message });
  } catch (err) {
    console.error('[dmRespond] OpenAI error:', err?.message || err);
    return localFallback({ stage, character, message });
  }
}

// Narrar resultados de tirada (tu función original)
export function narrateOutcome({ outcome, skill, character }) {
  const name = character?.name || 'Tu personaje';
  const sk = skill ? ` (${skill})` : '';
  if (outcome === 'success') return `${name}${sk} triunfa con soltura; la escena se abre a su favor.`;
  if (outcome === 'mixed')   return `${name}${sk} lo consigue, pero surge una complicación que cambia el tono de la sala.`;
  return `${name}${sk} falla. El ambiente se enrarece y algo se les escapa de las manos.`;
}
