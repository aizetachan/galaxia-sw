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
    throw new Error('OPENAI_API_KEY missing'); // IA es obligatoria
  }
  if (openaiClient) return openaiClient;
  const mod = await import('openai');
  const OpenAI = mod.default || mod.OpenAI || mod;
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

/* ========= Utilidades ========= */
function isResponsesModel(model = '') {
  // Modelos que usan Responses API y token param 'max_output_tokens'
  return /(^gpt-5|gpt-4\.1|^o3|mini)/i.test(model);
}

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
    console.warn('[DM] saveMsg warn', e?.message);
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

/* ========= Handler IA ========= */
async function handleDM(req, res) {
  const started = Date.now();
  try {
    const userId = req.auth?.userId || null;
    const text = extractUserText(req.body);
    const bodyKeys = Object.keys(req.body || {});

    console.log('[DM] incoming', {
      url: req.originalUrl, userId, characterId: req.body?.character?.id || null,
      hasAuth: !!userId, bodyKeys, textSample: (text || '').slice(0,80)
    });

    if (!text) {
      const t = '¿Puedes repetir la acción o pregunta?';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t });
    }

    // Personaje activo (si lo hay)
    let characterId = toInt(req.body?.character_id || req.body?.character?.id);
    if (!characterId && hasDb && userId) {
      const { rows } = await sql(`SELECT id FROM characters WHERE owner_user_id=$1 LIMIT 1`, [userId]);
      characterId = rows[0]?.id || null;
    }

    await saveMsg(userId, 'user', text);

    const brief = await worldBrief(characterId);
    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
    const temp = Number(process.env.DM_TEMPERATURE ?? 0.8) || 0.8;
    const maxOut = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS ?? 800) || 800;

    const system = [
      'Eres el Máster de un juego de rol en una galaxia compartida.',
      'Responde SIEMPRE en español, 2–6 frases, enfocadas a acción y consecuencias.',
      'Integra continuidad a partir de los documentos/MD y el estado persistido.',
      'Sugiere 2–3 opciones claras para el siguiente paso del jugador.',
      brief ? '\nContexto del mundo:\n' + brief : ''
    ].join('\n');

    let outText = null;
    const client = await getOpenAI();

    try {
      if (isResponsesModel(model)) {
        // -------- Responses API (gpt-5, 4.1, o3, mini) ----------
        console.log('[DM] OpenAI request', { api: 'responses', model, temp, maxOut });
        const resp = await client.responses.create({
          model,
          input: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
          temperature: temp,
          max_output_tokens: Math.max(1, Math.min(maxOut, 8192)),
        });
        outText = (resp.output_text || '').trim();
      } else {
        // -------- Chat Completions (modelos legacy) -------------
        console.log('[DM] OpenAI request', { api: 'chat.completions', model, temp });
        const payload = {
          model,
          temperature: temp,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
        };
        // Para evitar el error de "max_tokens vs max_completion_tokens"
        if (/gpt-4o|gpt-3\.5|gpt-4(?!\.1)/i.test(model)) {
          payload.max_tokens = Math.max(1, Math.min(maxOut, 4096));
        }

        const resp = await client.chat.completions.create(payload);
        outText = resp.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch (e) {
      // Log ampliado
      let body = null;
      try { body = e?.response?.data ?? e?.error ?? null; } catch {}
      console.error('[DM] OpenAI error', {
        status: e?.status, code: e?.code, message: e?.message, body
      });
    }

    if (!outText) {
      const t = 'Interferencia en la HoloNet. El máster no responde ahora mismo; repite la acción más tarde.';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({
        ok: true,
        reply: { text: t },
        text: t,
        message: t,
        meta: { ai_ok: false, model, reason: 'openai_call_failed', ms: Date.now() - started }
      });
    }

    await saveMsg(userId, 'dm', outText);
    return res.status(200).json({
      ok: true,
      reply: { text: outText },
      text: outText,
      message: outText,
      meta: { ai_ok: true, model, ms: Date.now() - started }
    });
  } catch (e) {
    console.error('[DM] fatal:', e?.message || e);
    const t = 'Fallo temporal del servidor. Repite la acción en un momento.';
    return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t });
  }
}

/* ========= Rutas ========= */
router.post('/dm', optionalAuth, handleDM);
router.post('/dm/respond', optionalAuth, handleDM);

// Diagnóstico: mini llamada para comprobar modelo/clave/salida a OpenAI
router.get('/ai/health', async (_req, res) => {
  try {
    const client = await getOpenAI();
    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
    if (isResponsesModel(model)) {
      const r = await client.responses.create({
        model,
        input: 'ping',
        max_output_tokens: 8
      });
      return res.json({ ok: true, model, api: 'responses', text: r.output_text || '' });
    } else {
      const r = await client.chat.completions.create({
        model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8
      });
      return res.json({ ok: true, model, api: 'chat', text: r.choices?.[0]?.message?.content || '' });
    }
  } catch (e) {
    let body = null;
    try { body = e?.response?.data ?? e?.error ?? null; } catch {}
    return res.status(500).json({ ok: false, error: e?.message || 'openai_error', detail: body });
  }
});

export default router;
