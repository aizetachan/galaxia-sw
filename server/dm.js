// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { optionalAuth } from './auth.js';

const router = Router();
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* ========= Carga perezosa del SDK (evita crasheos en build) ========= */
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
    console.warn('[DM] saveMsg warn:', e?.message);
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

/* ========= llamada a OpenAI (Responses API, gpt-5-mini) ========= */
async function callMaster(text, brief, history = []) {
  const client = await getOpenAI();
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const temperature = Number(process.env.DM_TEMPERATURE ?? 0.8);
  const top_p = process.env.DM_TOP_P != null ? Number(process.env.DM_TOP_P) : undefined;
  const max_completion_tokens = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS ?? 500);

  // Condensamos últimas líneas del chat del front (solo texto)
  const histLines = []
    .concat(history || [])
    .slice(-8)
    .map(m => `${m.user || (m.kind === 'dm' ? 'Máster' : 'Jugador')}: ${m.text}`)
    .join('\n');

  const system = [
    'Eres el Máster de un juego de rol en una galaxia compartida.',
    'Responde SIEMPRE en español, 2–6 frases, orientadas a acción, consecuencias y ganchos.',
    'Mantén continuidad con el mundo persistido y su historia; ofrece 2–3 opciones claras.',
    brief ? '\n[Contexto del mundo]\n' + brief : '',
    histLines ? '\n[Últimos mensajes]\n' + histLines : ''
  ].filter(Boolean).join('\n');

  // Responses API: usar "input" y "max_completion_tokens"
  const payload = {
    model,
    temperature,
    max_completion_tokens,
    // top_p solo si nos lo pasan (para no chocar con políticas del modelo si no aplica)
    ...(top_p != null ? { top_p } : {}),
    input: [
      { role: 'system', content: [{ type: 'text', text: system }] },
      { role: 'user',   content: [{ type: 'text', text }] },
    ],
  };

  console.log('[DM] OpenAI payload:', { model, temperature, max_completion_tokens });

  const resp = await client.responses.create(payload);

  // Responses API suele exponer esto:
  const out1 = resp.output_text?.trim?.();
  if (out1) return out1;

  // Salvaguardas (por si la librería cambia)
  const maybeText = resp?.output?.map?.(o => o?.content?.map?.(c => c?.text)?.join('') ?? '').join('').trim();
  if (maybeText) return maybeText;

  // fallback genérico
  return null;
}

/* ========= handler IA-primero ========= */
async function handleDM(req, res) {
  try {
    const userId = req.auth?.userId || null;
    const text = extractUserText(req.body);

    if (!text) {
      const t = '¿Puedes repetir la acción o pregunta?';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t });
    }

    // Personaje activo (si lo hay)
    let characterId = toInt(req.body?.character_id);
    if (!characterId && hasDb && userId) {
      const { rows } = await sql(`SELECT id FROM characters WHERE owner_user_id=$1 LIMIT 1`, [userId]);
      characterId = rows[0]?.id || null;
    }

    await saveMsg(userId, 'user', text);

    const brief = await worldBrief(characterId);

    // === Llamada a IA (prioritaria) ===
    let outText = null;
    try {
      outText = await callMaster(text, brief, req.body?.history || []);
    } catch (e) {
      // Log rico para depurar (status, code, detalles)
      const status = e?.status ?? e?.response?.status;
      const code = e?.code ?? e?.response?.data?.error?.code;
      const msg = e?.message || String(e);
      console.error('[DM] OpenAI error:', { status, code, msg });
    }

    // Fallback respetuoso (no generamos narrativa local)
    if (!outText) {
      const t = 'Interferencia en la HoloNet. El máster no responde ahora mismo; repite la acción más tarde.';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({
        ok: true,
        reply: { text: t },
        text: t,
        message: t,
        meta: { ai_ok: false, reason: 'openai_call_failed' }
      });
    }

    await saveMsg(userId, 'dm', outText);
    return res.status(200).json({
      ok: true,
      reply: { text: outText },
      text: outText,
      message: outText,
      meta: { ai_ok: true, model: process.env.OPENAI_MODEL || 'gpt-5-mini' }
    });
  } catch (e) {
    console.error('[DM] fatal:', e?.message || e);
    const t = 'Fallo temporal del servidor. Repite la acción en un momento.';
    return res.status(200).json({ ok: true, reply: { text: t }, text: t, message: t });
  }
}

/* ========= rutas (compatibles con /api/dm/respond) ========= */
router.post('/respond', optionalAuth, handleDM);
router.post('/',        optionalAuth, handleDM); // por si llamas /api/dm directamente

export default router;
