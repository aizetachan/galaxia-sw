// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { optionalAuth } from './auth.js';

const router = Router();
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* ========= Carga perezosa del SDK ========= */
let openaiClient = null;
async function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY missing');
  }
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
    await sql(
      `INSERT INTO chat_messages(user_id, role, kind, text, ts)
       VALUES ($1,$2,$2,$3, now())`,
      [userId || null, role, text]
    );
  } catch (e) {
    console.warn('[DM] saveMsg error', e?.message || e);
  }
}

async function worldBrief(characterId) {
  if (!hasDb || !characterId) return '';
  const [{ rows: cRows }, { rows: eNear }, { rows: eFaction }, { rows: eMine }] = await Promise.all([
    sql(`SELECT id,name,species,role,last_location FROM characters WHERE id=$1`, [characterId]),
    sql(`SELECT e.ts,e.summary,e.location,e.kind FROM events e
         WHERE e.visibility='public' AND e.location IS NOT NULL
           AND e.location=(SELECT last_location FROM characters WHERE id=$1)
         ORDER BY e.ts DESC LIMIT 8`, [characterId]),
    sql(`SELECT e.ts,e.summary,e.kind FROM faction_memberships fm
         JOIN events e ON e.visibility='faction' AND e.faction_id=fm.faction_id
         WHERE fm.character_id=$1 ORDER BY e.ts DESC LIMIT 6`, [characterId]),
    sql(`SELECT e.ts,e.summary,e.kind FROM events e
         WHERE e.actor_character_id=$1 ORDER BY e.ts DESC LIMIT 4`, [characterId]),
  ]);
  const c = cRows[0]; if (!c) return '';
  const L = [`PJ: ${c.name} (${c.species || '—'}/${c.role || '—'}) en ${c.last_location || 'desconocido'}.`];
  if (eMine?.length)   { L.push('Actos propios:');  eMine.forEach(e => L.push(`- [${e.kind || 'evento'}] ${e.summary}`)); }
  if (eNear?.length)   { L.push('Cerca (público):'); eNear.forEach(e => L.push(`- ${e.summary} @ ${e.location}`)); }
  if (eFaction?.length){ L.push('De tu facción:');  eFaction.forEach(e => L.push(`- ${e.summary}`)); }
  return L.join('\n');
}

/* ========= llamada robusta a OpenAI ========= */
function isGpt5(model) {
  return /^gpt-5/i.test(model || '');
}

/**
 * Intenta Chat Completions primero (mínimo de campos).
 * Si hay 400/422/unsupported, reintenta con Responses API.
 */
async function callOpenAI({ client, model, system, userText }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ];

  // 1) Chat Completions: sin temperature para gpt-5*
  try {
    const payload = { model, messages };
    if (!isGpt5(model)) {
      const t = Number(process.env.DM_TEMPERATURE ?? '0.9');
      if (Number.isFinite(t)) payload.temperature = t;
    }
    console.log('[DM] OpenAI chat.completions payload keys =', Object.keys(payload));
    const resp = await client.chat.completions.create(payload);
    const out = resp.choices?.[0]?.message?.content?.trim() || null;
    if (out) return out;
  } catch (e) {
    const status = e?.status || e?.response?.status;
    const code = e?.code || e?.response?.data?.error?.type;
    const msg = e?.message || e?.response?.data?.error?.message;
    console.error('[DM] OpenAI chat error:', { status, code, msg });
    // Sólo caemos a Responses en errores de validación/param
    if (![400, 422].includes(status)) throw e;
  }

  // 2) Responses API (payload mínimo y compatible con gpt-5)
  try {
    const input = [
      { role: 'system', content: system },
      { role: 'user', content: userText },
    ];

    const r2 = await client.responses.create({
      model,
      input,
      // Si quisieras limitar tokens y tu modelo lo soporta, usa:
      // max_output_tokens: Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || '0') || undefined,
    });
    // En Responses, el helper más simple:
    const out = r2.output_text || null;
    if (out && out.trim()) return out.trim();

    // Otras formas de extraer texto, por si tu SDK devuelve forma distinta:
    const fallback =
      r2?.content?.[0]?.text ||
      r2?.choices?.[0]?.message?.content ||
      null;
    return (typeof fallback === 'string' && fallback.trim()) ? fallback.trim() : null;
  } catch (e2) {
    const status2 = e2?.status || e2?.response?.status;
    const code2 = e2?.code || e2?.response?.data?.error?.type;
    const msg2 = e2?.message || e2?.response?.data?.error?.message;
    console.error('[DM] OpenAI responses error:', { status: status2, code: code2, msg: msg2 });
    throw e2;
  }
}

/* ========= handler ========= */
async function handleDM(req, res) {
  const url = req.originalUrl || req.url;
  const userId = req.auth?.userId || null;
  const hasAuth = !!userId;
  const text = extractUserText(req.body);

  console.log('[DM] incoming {',
    '\n  url:', JSON.stringify(url),
    '\n  userId:', JSON.stringify(userId),
    '\n  characterId:', JSON.stringify(req.body?.character_id || null),
    '\n  hasAuth:', hasAuth,
    '\n  bodyKeys:', Object.keys(req.body || {}),
    '\n  textSample:', JSON.stringify(text?.slice?.(0, 40) || ''),
    '\n}');

  try {
    if (!text) {
      const t = '¿Puedes repetir la acción o pregunta?';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t });
    }

    // Personaje activo (si lo hay)
    let characterId = toInt(req.body?.character_id);
    if (!characterId && hasDb && userId) {
      const { rows } = await sql(`SELECT id FROM characters WHERE owner_user_id=$1 LIMIT 1`, [userId]);
      characterId = rows?.[0]?.id || null;
    }

    await saveMsg(userId, 'user', text);

    const brief = await worldBrief(characterId);
    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

    const system = [
      'Eres el Máster de un juego de rol en una galaxia compartida.',
      'Responde SIEMPRE en español, 2–6 frases, enfocado a acción y consecuencias.',
      'Integra continuidad a partir del estado persistido y documentos/MD.',
      'Propón 2–3 opciones claras para el siguiente paso del jugador.',
      brief ? '\nContexto del mundo:\n' + brief : ''
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

/* ========= rutas ========= */
router.post('/dm', optionalAuth, handleDM);
router.post('/dm/respond', optionalAuth, handleDM);

export default router;
