// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { optionalAuth } from './auth.js';

const router = Router();
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* ========= Carga perezosa del SDK (evita crasheos en build) ========= */
let openaiClient = null;
async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('[DM] OPENAI_API_KEY missing');
    throw new Error('OPENAI_API_KEY missing');
  }
  if (openaiClient) return openaiClient;
  const mod = await import('openai'); // carga dinámica
  const OpenAI = mod.default || mod.OpenAI || mod;
  openaiClient = new OpenAI({ apiKey: key });
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
  if (eMine.length)   { L.push('Actos propios:');  eMine.forEach(e => L.push(`- [${e.kind || 'evento'}] ${e.summary}`)); }
  if (eNear.length)   { L.push('Cerca (público):'); eNear.forEach(e => L.push(`- ${e.summary} @ ${e.location}`)); }
  if (eFaction.length){ L.push('De tu facción:');  eFaction.forEach(e => L.push(`- ${e.summary}`)); }
  return L.join('\n');
}

/* ========= util modelo ========= */
function preferResponsesAPI(model) {
  // gpt-5-mini y familia nueva usan Responses API (y max_completion_tokens)
  return /^gpt-5/i.test(String(model || ''));
}
function pickModel() {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}
function pickTemp() {
  const t = Number(process.env.DM_TEMPERATURE ?? process.env.OPENAI_TEMPERATURE ?? 0.8);
  return Number.isFinite(t) ? t : 0.8;
}
function pickMaxCompletionTokens() {
  const n = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS ?? process.env.DM_MAX_TOKENS ?? 300);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/* ========= handler IA-primero ========= */
async function handleDM(req, res) {
  const debug = String(req.query?.debug || '') === '1';
  const startedAt = Date.now();

  try {
    const userId = req.auth?.userId || null;
    const text = extractUserText(req.body);
    let characterId = toInt(req.body?.character_id);

    console.log('[DM] incoming', {
      url: req.originalUrl,
      userId,
      characterId,
      hasAuth: !!req.auth,
      bodyKeys: Object.keys(req.body || {}),
      textSample: (text || '').slice(0, 140)
    });

    if (!text) {
      const t = '¿Puedes repetir la acción o pregunta?';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t, meta: { reason: 'empty_text' } });
    }

    if (!characterId && hasDb && userId) {
      const { rows } = await sql(`SELECT id FROM characters WHERE owner_user_id=$1 LIMIT 1`, [userId]);
      characterId = rows[0]?.id || null;
    }

    await saveMsg(userId, 'user', text);

    const brief = await worldBrief(characterId);
    const model = pickModel();
    const temperature = pickTemp();
    const max_completion_tokens = pickMaxCompletionTokens();
    const useResponses = preferResponsesAPI(model);

    console.log('[DM] openai.prepare', {
      model, temperature, max_completion_tokens, useResponses,
      briefLen: brief?.length || 0
    });

    let outText = null;
    let raw = null;
    let errorInfo = null;

    try {
      const client = await getOpenAI();
      const system = [
        'Eres el Máster de un juego de rol en una galaxia compartida.',
        'Responde SIEMPRE en español, 2–6 frases, enfocadas a acción y consecuencias.',
        'Integra continuidad a partir de los documentos/MD y el estado persistido.',
        'Sugiere 2–3 opciones claras para el siguiente paso del jugador.',
        brief ? '\nContexto del mundo:\n' + brief : ''
      ].join('\n');

      if (useResponses) {
        // === Responses API (gpt-5-mini y similares)
        const payload = {
          model,
          temperature,
          max_completion_tokens,
          input: [
            { role: 'system', content: [{ type: 'text', text: system }] },
            { role: 'user',   content: [{ type: 'text', text }] }
          ],
        };
        console.log('[DM] openai.responses.create payload', { ...payload, input: undefined });
        const r = await client.responses.create(payload);
        raw = r;
        outText =
          (typeof r.output_text === 'string' && r.output_text.trim()) ||
          r?.output?.[0]?.content?.[0]?.text?.trim() ||
          null;
      } else {
        // === Chat Completions (gpt-4o-mini o legacy)
        const payload = {
          model,
          temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
          // No enviar max_tokens a modelos que no lo soporten
        };
        console.log('[DM] openai.chat.completions.create payload', { ...payload, messages: undefined });
        const r = await client.chat.completions.create(payload);
        raw = r;
        outText = r?.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch (e) {
      // Captura exhaustiva del error de OpenAI
      errorInfo = {
        status: e?.status,
        code: e?.code,
        message: e?.message,
        type: e?.type,
        data: e?.response?.data || e?.response?.body || null,
      };
      console.error('[DM] OpenAI error', errorInfo);
    }

    const tookMs = Date.now() - startedAt;
    console.log('[DM] openai.done', { hasText: !!outText, tookMs });

    if (!outText) {
      const msg = 'Interferencia en la HoloNet. El máster no responde ahora mismo; repite la acción más tarde.';
      await saveMsg(userId, 'dm', msg);
      return res.status(200).json({
        ok: true,
        reply: { text: msg },
        text: msg,
        message: msg,
        meta: { ai_ok: false, model, reason: 'openai_call_failed', error: errorInfo, tookMs, debug: debug ? { raw } : undefined }
      });
    }

    await saveMsg(userId, 'dm', outText);
    return res.status(200).json({
      ok: true,
      reply: { text: outText },
      text: outText,
      message: outText,
      meta: { ai_ok: true, model, tookMs, debug: debug ? { raw } : undefined }
    });

  } catch (e) {
    console.error('[DM] fatal', e?.message || e);
    const t = 'Fallo temporal del servidor. Repite la acción en un momento.';
    return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t, meta: { fatal: true } });
  }
}

/* ========= rutas (incluye compat /dm/respond) ========= */
router.post('/respond', optionalAuth, handleDM);   // /api/dm/respond
router.post('/', optionalAuth, handleDM);          // /api/dm

export default router;
