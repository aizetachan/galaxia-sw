// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { optionalAuth } from './auth.js';

const router = Router();
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

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
  } catch (e) {
    console.warn('[DM] saveMsg error', e?.message || e);
  }
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
    } catch (e) {
      console.warn('[DM] lookup character by user_id error:', e?.message || e);
    }
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
  } catch (e) {
    console.warn('[DM] worldBrief error:', e?.message || e);
    return '';
  }
}

/* ========= historial reciente (para prompt y /resume) ========= */
function compressLine(s = '') {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function getRecentChatSummary(userId, limit = 200) {
  if (!hasDb || !toInt(userId)) return { lines: [], lastTs: null };
  const uid = toInt(userId);
  const { rows } = await sql(
    `SELECT role, text, ts
       FROM chat_messages
      WHERE user_id = $1
      ORDER BY ts DESC
      LIMIT $2`,
    [uid, Math.min(limit, 200)]
  );
  const ordered = rows.slice().reverse(); // cronológico
  const lines = ordered.map(r => `${r.role === 'user' ? 'Jugador' : 'Máster'}: ${compressLine(r.text || '')}`);
  const lastTs = rows[0]?.ts || null;
  return { lines, lastTs };
}

/* ========= Política de idioma y de dados para el Máster ========= */
const languagePolicy = [
  'IDIOMA:',
  '- Responde por defecto en español.',
  '- Si el jugador escribe de forma clara en otro idioma o lo solicita explícitamente, responde en ese idioma.',
].join('\n');

const dicePolicy = [
  'CUÁNDO PEDIR TIRADA:',
  '- Pide una tirada siempre que exista: riesgo real de fracaso; oposición activa (otro personaje, facción o entorno); incertidumbre en el resultado; o que el desenlace pueda cambiar de forma significativa la narrativa.',
  '- Casos típicos: combate, persecuciones, uso de la Fuerza, intentos de manipulación o diplomacia, hackeos, exploraciones peligrosas, decisiones críticas y cualquier situación no resoluble solo por lógica.',
  '- No pidas tirada si la acción es rutinaria/segura o sin impacto relevante.',
  '',
  'CÓMO PEDIRLA:',
  '- Emite exactamente: <<ROLL SKILL="<Habilidad>" REASON="<Motivo breve>">>.',
  '- Solicita UNA única tirada por acción; si hay varios aspectos, elige la habilidad más pertinente.',
  '- Si hay oposición directa, menciónalo en REASON (p. ej., "oposición del guardia").',
  '',
  'RESOLUCIÓN:',
  '- Tras recibir <<DICE_OUTCOME SKILL="..." OUTCOME="success|mixed|fail">>, aplica consecuencias según las reglas y continúa la escena con claridad.',
].join('\n');

/* ========= llamada robusta a OpenAI ========= */
function isGpt5(model) {
  return /^gpt-5/i.test(model || '');
}

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

  try {
    const r2 = await client.responses.create({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
    });
    const out = r2.output_text || r2?.content?.[0]?.text || r2?.choices?.[0]?.message?.content || null;
    return (typeof out === 'string' && out.trim()) ? out.trim() : null;
  } catch (e2) {
    throw e2;
  }
}

/* ========= handler principal ========= */
async function handleDM(req, res) {
  const url = req.originalUrl || req.url;
  const userId = req.auth?.userId || null;
  const hasAuth = !!userId;
  const text = extractUserText(req.body);

  console.log('[DM] incoming {',
    '\n  url:', JSON.stringify(url),
    '\n  userId:', JSON.stringify(userId),
    '\n  characterId(raw):', JSON.stringify(req.body?.character_id || null),
    '\n  hasAuth:', hasAuth,
    '\n  stage:', JSON.stringify(req.body?.stage || null),
    '\n  bodyKeys:', Object.keys(req.body || {}),
    '\n  textSample:', JSON.stringify(text?.slice?.(0, 40) || ''),
    '\n}');

  try {
    if (!text) {
      const t = '¿Puedes repetir la acción o pregunta?';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t });
    }

    const characterId = await getNumericCharacterId({ body: req.body, userId });
    await saveMsg(userId, 'user', text);

    const [brief, history] = await Promise.all([
      worldBrief(characterId),
      getRecentChatSummary(userId, 80), // unas 80 líneas para contexto
    ]);

    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
    const historyBlock = (history.lines.length
      ? ('\nHistorial reciente (resumen cronológico corto):\n' + history.lines.slice(-20).join('\n'))
      : '');

    const system = [
      'Eres el Máster de un juego de rol en una galaxia compartida.',
      // Idioma adaptable (español por defecto).
      languagePolicy,
      // Estilo de respuesta y continuidad.
      'Responde conciso (2–6 frases), orientado a acción y consecuencias.',
      'Integra continuidad a partir del estado persistido y del historial reciente del jugador.',
      // No listar opciones salvo que el jugador las pida.
      'No enumeres opciones a menos que el jugador las pida explícitamente.',
      // Política de dados (cuándo y cómo pedir tirada).
      dicePolicy,
      brief ? ('\nContexto del mundo:\n' + brief) : '',
      historyBlock,
    ].join('\n');

    let outText = null;
    try {
      const client = await getOpenAI();
      outText = await callOpenAI({ client, model, system, userText: text });
    } catch (e) {
      console.error('[DM] OpenAI fatal:', e?.status, e?.code, e?.message);
    }

    if (!outText) {
      const t = 'Interferencia en la HoloNet. El máster no responde ahora mismo; repite la acción más tarde.';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({
        ok: true,
        reply: { text: t },
        text: t,
        message: t,
        meta: { ai_ok: false, model, reason: 'openai_call_failed' }
      });
    }

    await saveMsg(userId, 'dm', outText);
    return res.status(200).json({
      ok: true,
      reply: { text: outText },
      text: outText,
      message: outText,
      meta: { ai_ok: true, model }
    });
  } catch (e) {
    console.error('[DM] fatal:', e?.message || e);
    const t = 'Fallo temporal del servidor. Repite la acción en un momento.';
    return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t });
  }
}

/* ========= /api/dm/resume =========
   Devuelve saludo + mini-resumen de la última sesión, si la hay.
   Útil cuando el chat local está vacío pero el usuario tiene sesión. */
router.get('/resume', optionalAuth, async (req, res) => {
  try {
    const userId = toInt(req.auth?.userId);
    if (!userId || !hasDb) {
      return res.json({ ok: true, text: null, empty: true });
    }

    // Personaje y localización (si existen)
    const { rows: cRows } = await sql(
      `SELECT id, name, last_location
         FROM characters
        WHERE owner_user_id = $1
        LIMIT 1`,
      [userId]
    );
    const char = cRows?.[0] || null;

    // Últimos mensajes para resumen
    const { lines } = await getRecentChatSummary(userId, 40);
    if (!lines.length) {
      return res.json({ ok: true, text: null, empty: true });
    }

    // Resumen muy simple (sin depender de OpenAI)
    const short = lines.slice(-10).join(' · ');
    const helloName = char?.name ? `, **${char.name}**` : '';
    const loc = char?.last_location ? ` en **${char.last_location}**` : '';
    const text =
      `Salud de nuevo${helloName}${loc}. Resumen anterior: ${short}. ` +
      `¿Cómo deseas continuar?`;

    return res.json({
      ok: true,
      text,
      character: char || null,
      empty: false
    });
  } catch (e) {
    console.error('[DM/resume] error:', e?.message || e);
    return res.json({ ok: true, text: null, empty: true });
  }
});

/* ========= rutas ========= */
router.post('/', optionalAuth, handleDM);
router.post('/respond', optionalAuth, handleDM);

export default router;
