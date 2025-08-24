// server/dm.js
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Carga y cachea los .md
let cached = { master: null, rules: null, mtime: 0 };
async function loadPrompts() {
  try {
    const base = path.resolve(process.cwd(), 'content');
    const masterPath = path.join(base, 'master.md');
    const rulesPath = path.join(base, 'rules.md');

    const [master, rules] = await Promise.all([
      fs.readFile(masterPath, 'utf8').catch(() => null),
      fs.readFile(rulesPath, 'utf8').catch(() => null),
    ]);

    cached = {
      master: master || `Eres el Máster de una aventura espacial de estilo Star Wars.
Habla en segunda persona, tono cercano, cinematográfico pero claro. Evita muletillas.`,
      rules: rules || `Reglas mínimas: 
- Si el jugador decide algo sobre su PJ, no hay tirada.
- Si la acción depende del mundo/azar, sugiere tirar. No inventes resultados sin tirada.
- Nunca reveles reglas meta salvo que te las pidan.`,
      mtime: Date.now()
    };
  } catch {
    // deja defaults
  }
}

async function ensurePromptsLoaded() {
  // recarga cada 60s por si editas los .md en caliente
  if (!cached.master || Date.now() - cached.mtime > 60_000) {
    await loadPrompts();
  }
}

function serializeHistory(history = []) {
  // Convierte tu buffer (msgs con .kind/.text) a turnos para el modelo
  // Solo últimas ~8 ya las recortas en el front
  const turns = [];
  for (const m of history) {
    const role = m.kind === 'user' ? 'user' : 'assistant';
    turns.push({ role, content: `${m.user}: ${m.text}` });
  }
  return turns;
}

export function narrateOutcome({ outcome, skill, character }) {
  const name = character?.name || 'tu personaje';
  const S = skill ? ` (${skill})` : '';
  if (outcome === 'success') return `Éxito${S}: ${name} logra su objetivo con soltura. Describe el siguiente paso.`;
  if (outcome === 'mixed') return `Éxito parcial${S}: ${name} consigue algo, pero aparece una complicación inmediata. ¿Cómo reaccionas?`;
  return `Fallo${S}: ${name} no lo consigue y la situación se complica. ¿Insistes, cambias de enfoque o retrocedes?`;
}

export async function dmRespond({ history = [], message, character, world, stage = 'done', intentRequired = false }) {
  await ensurePromptsLoaded();

  const system = [
    `# Rol`,
    cached.master,
    ``,
    `# Reglas`,
    cached.rules,
    ``,
    `# Contexto técnico`,
    `- stage actual: ${stage}`,
    `- intentRequired (tirada sugerida por heurística front): ${intentRequired}`,
    `- Si stage != "done", guía con calidez el paso (especie/rol) pero responde al chat igual.`,
    `- Si detectas acción incierta y no hay tirada resuelta, sugiere "pulsa Resolver tirada" sin bloquear la narración.`,
    `- Mantén respuestas breves (2–5 frases) salvo que te pidan detalle.`,
  ].join('\n');

  const worldBrief = world ? `Personajes: ${Object.keys(world.characters||{}).join(', ') || '—'}. Eventos totales: ${(world.events||[]).length}` : 'Sin world cache.';

  const userFrame = [
    `Jugador dice: "${message}"`,
    character ? `PJ: ${character.name} — ${character.species||'—'} ${character.role||''}. Última localización: ${character.lastLocation||'—'}.` : `Sin personaje aún.`,
    `World: ${worldBrief}`
  ].join('\n');

  const messages = [
    { role: 'system', content: system },
    ...serializeHistory(history),
    { role: 'user', content: userFrame }
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.8,
      max_tokens: 260,
      messages
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    return text || 'El neón chisporrotea sobre la barra. ¿Qué haces?';
  } catch (e) {
    console.error('[dmRespond] OpenAI error:', e?.response?.data || e?.message);
    return 'El canal se llena de estática. Intenta de nuevo en un momento.';
  }
}
