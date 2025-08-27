// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { optionalAuth } from './auth.js';
import fs from 'fs';
import path from 'path';

const router = Router();
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* ========= Lectura de prompts .md (ruta correcta + fallback legacy) ========= */
function readPrompt(filename) {
  const candidates = [
    path.join(process.cwd(), 'server', 'prompts', filename),          // ruta actual
    path.join(process.cwd(), 'server', 'data', 'prompts', filename),  // fallback legacy
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch {}
  }
  return '';
}

/* ========= Carga perezosa del SDK ========= */
let openaiClient = null;
async function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  if (openaiClient) return openaiClient;
  const mod = await import('openai');
  const OpenAI = mod.default || mod.OpenAI || mod;
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

/* ========= helpers ========= */
function extractUserText(body) {
  if (typeof body === 'string') return body.trim();
  if (body && typeof body === 'object') {
    const direct = body.text ?? body.message ?? body.prompt ?? body.content ?? body.input?.text;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    if (Array.isArray(body.messages)) {
      for (let i = body.messages.length - 1; i >= 0; i--) {
        const m = body.messages[i];
        if (m?.role === 'user' && typeof m?.content === 'string' && m.content.trim()) {
          return m.content.trim();
        }
      }
    }
  }
  return '';
}

async function saveMsg(userId, role, text) {
  if (!hasDb) return;
  try {
    const uid = toInt(userId);
    await sql(
      `INSERT INTO chat_messages(user_id, role, kind, text, ts)
       VALUES ($1,$2,$2,$3, now())`,
      [uid, role, text]
    );
  } catch (e) { console.warn('[DM] saveMsg error', e?.message || e); }
}

async function getNumericCharacterId({ body, userId }) {
  const cidFromBody = toInt(body?.character_id);
  if (cidFromBody) return cidFromBody;

  if (body?.character?.id && !toInt(body.character.id)) {
    console.log('[DM] Ignoring non-numeric character.id from body (guest UUID)');
  }

  if (hasDb && toInt(userId)) {
    try {
      const { rows } = await sql(
        `SELECT id FROM characters WHERE owner_user_id = $1 LIMIT 1`,
        [toInt(userId)]
      );
      if (rows?.[0]?.id) return rows[0].id;
    } catch (e) { console.warn('[DM] lookup character by user_id error:', e?.message || e); }
  }
  return null;
}

async function worldBrief(characterId) {
  try {
    if (!hasDb || !toInt(characterId)) return '';
    const cid = toInt(characterId);
    const [{ rows: cRows }, { rows: eNear }, { rows: eFaction }, { rows: eMine }] = await Promise.all([
      sql(`SELECT id,name,species,role,last_location FROM characters WHERE id=$1`, [cid]),
      sql(`SELECT e.ts,e.summary,e.location,e.kind FROM events e
           WHERE e.visibility='public' AND e.location IS NOT NULL
             AND e.location=(SELECT last_location FROM characters WHERE id=$1)
           ORDER BY e.ts DESC LIMIT 8`, [cid]),
      sql(`SELECT e.ts,e.summary,e.kind FROM faction_memberships fm
           JOIN events e ON e.visibility='faction' AND e.faction_id=fm.faction_id
           WHERE fm.character_id=$1 ORDER BY e.ts DESC LIMIT 6`, [cid]),
      sql(`SELECT e.ts,e.summary,e.kind FROM events e
           WHERE e.actor_character_id=$1 ORDER BY e.ts DESC LIMIT 4`, [cid]),
    ]);
    const c = cRows[0]; if (!c) return '';
    const L = [`PJ: ${c.name} (${c.species || '—'}/${c.role || '—'}) en ${c.last_location || 'desconocido'}.`];
    if (eMine?.length)   { L.push('Actos propios:');  eMine.forEach(e => L.push(`- [${e.kind || 'evento'}] ${e.summary}`)); }
    if (eNear?.length)   { L.push('Cerca (público):'); eNear.forEach(e => L.push(`- ${e.summary} @ ${e.location}`)); }
    if (eFaction?.length){ L.push('De tu facción:');  eFaction.forEach(e => L.push(`- ${e.summary}`)); }
    return L.join('\n');
  } catch (e) { console.warn('[DM] worldBrief error:', e?.message || e); return ''; }
}

function compressLine(s = '') {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 240);
}
async function getRecentChatSummary(userId, limit = 200) {
  if (!hasDb || !toInt(userId)) return { lines: [], lastTs: null };
  const uid = toInt(userId);
  const { rows } = await sql(
    `SELECT role, text, ts FROM chat_messages
      WHERE user_id = $1 ORDER BY ts DESC LIMIT $2`,
    [uid, Math.min(limit, 200)]
  );
  const ordered = rows.slice().reverse();
  const lines = ordered.map(r => `${r.role === 'user' ? 'Jugador' : 'Máster'}: ${compressLine(r.text || '')}`);
  const lastTs = rows[0]?.ts || null;
  return { lines, lastTs };
}

/* ========= Políticas y protocolo ========= */
const languagePolicy = [
  'IDIOMA:',
  '- Responde por defecto en español.',
  '- Si el jugador escribe en otro idioma o lo solicita, responde en ese idioma.',
].join('\n');

const tagProtocol = [
  'PROTOCOLO DE ETIQUETAS (SOLO PARA EL MÁSTER).',
  '- No muestres reglas internas ni metas [STAGE=...] en la salida.',
  '- No pidas al jugador que escriba etiquetas; el cliente envía <<CONFIRM_ACK ...>>.',
  '',
  'ETIQUETAS VÁLIDAS QUE DEBES EMITIR TÚ:',
  '- Para confirmar nombre de PERSONAJE: <<CONFIRM NAME="<Nombre>">>',
  '- Para confirmar propuesta de especie+rol: <<CONFIRM SPECIES="<Especie>" ROLE="<Rol>">>',
  'La etiqueta debe ir en una LÍNEA PROPIA, como ÚLTIMA línea del mensaje.',
].join('\n');

const dicePolicy = readPrompt('dice-rules.md') || [
  'CUÁNDO PEDIR TIRADA:',
  '- Pide tirada cuando haya riesgo real, oposición, incertidumbre o impacto narrativo.',
  'CÓMO PEDIRLA:',
  '- Emite: <<ROLL SKILL="<Habilidad>" REASON="<Motivo breve>">>.',
  'RESOLUCIÓN:',
  '- Tras <<DICE_OUTCOME ...>>, aplica consecuencias y continúa.',
].join('\n');

/* === Política para primera escena tras el onboarding (sin tirada) === */
const introPolicy = [
  'PRIMERA ESCENA (tras onboarding):',
  '- Si el mensaje del jugador contiene <<CONFIRM_ACK TYPE="build"...>>, trata esa respuesta como el arranque de aventura.',
  '- En tu PRIMER mensaje tras eso, NO emitas <<ROLL ...>>.',
  '- Comienza con una breve descripción del lugar y un gancho suave sin riesgo inmediato.',
  '- Espera al menos una intervención del jugador antes de cualquier tirada.',
].join('\n');

/* ========= Construcción del SYSTEM en función del stage ========= */
function buildSystem({ stage, brief, historyLines, isIntroStart }) {
  const core = readPrompt('prompt-master.md');
  const game = readPrompt('game-rules.md');

  const historyBlock = (historyLines?.length
    ? ('\nHistorial reciente (resumen cronológico corto):\n' + historyLines.slice(-20).join('\n'))
    : '');

  const onboarding = [
    'REGLAS DE ONBOARDING (no revelar al jugador):',
    `- STAGE actual: ${stage || 'name'} (no lo menciones).`,
    '- STAGE=name → Mensaje de bienvenida breve: "¡Bienvenido/a a la galaxia!" y pregunta: "¿Cómo se va a llamar tu personaje?".',
    '  • Si el jugador proporciona un nombre, confírmalo al final con: <<CONFIRM NAME="<Nombre>">>.',
    '- STAGE=build → Pregunta: "Cuéntame qué tipo de aventura quieres vivir en la galaxia".',
    '  • Propón 2–3 combinaciones coherentes (species + role) en viñetas cortas.',
    '  • Elige UNA propuesta principal y al final emite: <<CONFIRM SPECIES="<Especie>" ROLE="<Rol>">>.',
    '- STAGE=done → Continúa la narración normal; NO emitas confirmaciones.',
    '- Si recibes <<CONFIRM_ACK TYPE="name|build" DECISION="no">>, propone nuevas opciones y vuelve a emitir la etiqueta correspondiente.',
    '- Si recibes <<CONFIRM_ACK ... DECISION="yes">>, avanza de fase.',
  ].join('\n');

  const worldBlock = brief ? ('\nContexto del mundo:\n' + brief) : '';

  return [
    (core || 'Eres el Máster de un juego de rol en una galaxia compartida.'),
    game,
    languagePolicy,
    dicePolicy,
    tagProtocol,
    onboarding,
    isIntroStart ? introPolicy : '',          // <<--- inyecta aquí la política de primera escena
    worldBlock,
    historyBlock,
    // Estilo:
    'ESTILO: conciso (2–6 frases), orientado a acción/consecuencia, sin listas salvo en STAGE=build.',
  ].filter(Boolean).join('\n\n');
}

/* ========= OpenAI call ========= */
function isGpt5(model) { return /^gpt-5/i.test(model || ''); }

async function callOpenAI({ client, model, system, userText }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ];
  try {
    const payload = { model, messages };
    if (!isGpt5(model)) {
      const t = Number(process.env.DM_TEMPERATURE ?? '0.9');
      if (Number.isFinite(t)) payload.temperature = t;
    }
    const resp = await client.chat.completions.create(payload);
    const out = resp.choices?.[0]?.message?.content?.trim() || null;
    if (out) return out;
  } catch (e) {
    const status = e?.status || e?.response?.status;
    if (![400, 422].includes(status)) throw e;
  }

  // fallback a Responses API
  const r2 = await client.responses.create({
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: userText },
    ],
  });
  const out = r2.output_text || r2?.content?.[0]?.text || r2?.choices?.[0]?.message?.content || null;
  return (typeof out === 'string' && out.trim()) ? out.trim() : null;
}

/* ========= handler principal ========= */
async function handleDM(req, res) {
  const url = req.originalUrl || req.url;
  const userId = req.auth?.userId || null;
  const hasAuth = !!userId;
  const text = extractUserText(req.body);
  const isIntroStart = /<<\s*CONFIRM_ACK[^>]*\bTYPE\s*=\s*"build"/i.test(text || '');
  const stage = String(req.body?.stage || 'name');

  console.log('[DM] incoming {',
    '\n  url:', JSON.stringify(url),
    '\n  userId:', JSON.stringify(userId),
    '\n  stage:', JSON.stringify(stage),
    '\n  isIntroStart:', isIntroStart,
    '\n  textSample:', JSON.stringify(text?.slice?.(0, 60) || ''),
    '\n}');

  try {
    if (!text && stage === 'done') {
      const t = '¿Puedes repetir la acción o pregunta?';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, text: t });
    }

    const characterId = await getNumericCharacterId({ body: req.body, userId });
    await saveMsg(userId, 'user', text || '(kickoff)');

    const [brief, history] = await Promise.all([
      worldBrief(characterId),
      getRecentChatSummary(userId, 80),
    ]);

    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
    const system = buildSystem({
      stage,
      brief,
      historyLines: history.lines,
      isIntroStart,               // <<--- pasa el flag
    });

    let outText = null;
    try {
      const client = await getOpenAI();
      outText = await callOpenAI({ client, model, system, userText: text || '<<CLIENT_HELLO>>' });
    } catch (e) {
      console.error('[DM] OpenAI fatal:', e?.status, e?.code, e?.message);
    }

    if (!outText) {
      const t = 'Interferencia en la HoloNet. El Máster no responde ahora mismo; repite la acción más tarde.';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, text: t, meta: { ai_ok: false, model } });
    }

    await saveMsg(userId, 'dm', outText);
    return res.status(200).json({ ok: true, text: outText, meta: { ai_ok: true, model } });

  } catch (e) {
    console.error('[DM] fatal:', e?.message || e);
    const t = 'Fallo temporal del servidor. Repite la acción en un momento.';
    return res.status(200).json({ ok: true, text: t });
  }
}

/* ========= /api/dm/resume ========= */
router.get('/resume', optionalAuth, async (req, res) => {
  try {
    const userId = toInt(req.auth?.userId);
    if (!userId || !hasDb) return res.json({ ok: true, text: null, empty: true });

    const { rows: cRows } = await sql(
      `SELECT id, name, last_location FROM characters WHERE owner_user_id = $1 LIMIT 1`,
      [userId]
    );
    const char = cRows?.[0] || null;

    const { lines } = await getRecentChatSummary(userId, 40);
    if (!lines.length) return res.json({ ok: true, text: null, empty: true });

    const short = lines.slice(-10).join(' · ');
    const helloName = char?.name ? `, **${char.name}**` : '';
    const loc = char?.last_location ? ` en **${char.last_location}**` : '';
    const text =
      `Salud de nuevo${helloName}${loc}. Resumen anterior: ${short}. ` +
      `¿Cómo deseas continuar?`;

    return res.json({ ok: true, text, character: char || null, empty: false });
  } catch (e) {
    console.error('[DM/resume] error:', e?.message || e);
    return res.json({ ok: true, text: null, empty: true });
  }
});

/* ========= rutas ========= */
router.post('/', optionalAuth, handleDM);
router.post('/respond', optionalAuth, handleDM);

export default router;
