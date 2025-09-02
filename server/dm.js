// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { optionalAuth, requireAuth } from './auth.js';
import { getPromptSection } from './prompts.js';
import { getOpenAI } from './openai-client.js';

const router = Router();

/* =========================
 * Utilidades y helpers
 * ========================= */
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function firstLine(str = '') {
  const i = String(str || '').indexOf('\n');
  return i === -1 ? String(str || '') : String(str || '').slice(0, i);
}
function restAfterFirstLine(str = '') {
  const i = String(str || '').indexOf('\n');
  return i === -1 ? '' : String(str || '').slice(i + 1);
}
function parseHeadJSON(text = '') {
  try {
    const head = firstLine(text).trim();
    const j = JSON.parse(head);
    if (!j || typeof j !== 'object' || !j.ui || !j.control) return null;
    return j;
  } catch {
    return null;
  }
}

// Pequeño normalizador de entrada del usuario
function wantsSuggestion(userMsg = '') {
  const t = String(userMsg || '').toLowerCase();
  return t === 'sugerir' || t === 'sugerencia' || t.includes('sugerir') || t.includes('sugerencia');
}

/* =========================
 * DB helpers (AJUSTA nombres si difieren)
 * ========================= */

// Crea thread en onboarding:name si no existe ninguno activo para el user
async function getOrCreateOnboardingThread(userId) {
  if (!hasDb) throw new Error('DB not available');
  const uid = toInt(userId);

  // 1) ¿Existe ya un thread para este user en onboarding?
  const existing = await sql(
    `SELECT id, user_id, character_id, state
       FROM story_threads
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [uid]
  );
  const row = existing?.rows?.[0];

  if (row && row.state && row.state.startsWith('onboarding')) {
    return row;
  }

  // Si hay thread pero ya no está en onboarding, para el caso "usuario nuevo" volvemos a crear uno limpio
  const ins = await sql(
    `INSERT INTO story_threads (user_id, state, updated_at)
     VALUES ($1, 'onboarding:name', now())
     RETURNING id, user_id, character_id, state`,
    [uid]
  );
  return ins.rows[0];
}

async function getOrCreateCharacterForUser(userId) {
  const uid = toInt(userId);
  const q1 = await sql(
    `SELECT id, user_id, name, species, role
       FROM characters
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [uid]
  );
  if (q1.rows[0]) return q1.rows[0];

  const ins = await sql(
    `INSERT INTO characters (user_id, updated_at)
     VALUES ($1, now())
     RETURNING id, user_id, name, species, role`,
    [uid]
  );

  // Relación tabla puente si existe
  try {
    await sql(
      `INSERT INTO user_characters (user_id, character_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [uid, ins.rows[0].id]
    );
  } catch (_) {
    // ignora si no existe la tabla o constraint
  }

  return ins.rows[0];
}

async function linkThreadCharacter(threadId, characterId) {
  try {
    await sql(
      `UPDATE story_threads
          SET character_id = $2,
              updated_at = now()
        WHERE id = $1`,
      [toInt(threadId), toInt(characterId)]
    );
  } catch (e) {
    console.warn('[DM] linkThreadCharacter error:', e?.message || e);
  }
}

async function setThreadState(threadId, state) {
  await sql(
    `UPDATE story_threads
        SET state = $2,
            updated_at = now()
      WHERE id = $1`,
    [toInt(threadId), String(state)]
  );
}

async function saveChat(userId, threadId, role, text) {
  await sql(
    `INSERT INTO chat_messages (user_id, thread_id, role, text, ts)
     VALUES ($1, $2, $3, $4, now())`,
    [toInt(userId), toInt(threadId), role, text]
  );
}

/* =========================
 * Prompts
 * ========================= */

function buildSystemFor(state, { characterBrief = '' } = {}) {
  // Usamos secciones de tu prompt-master.md
  // OUTPUT_CONTRACT debe describir: primera línea JSON {ui,control} + narración desde la segunda línea
  const contract = getPromptSection('prompt-master.md', 'OUTPUT_CONTRACT');
  const style = getPromptSection('prompt-master.md', 'STYLE');
  const onboarding = getPromptSection('prompt-master.md', 'ONBOARDING');
  const play = getPromptSection('prompt-master.md', 'PLAY');

  let body = contract + '\n\n' + style + '\n\n';

  if (state === 'onboarding:name' || state === 'onboarding:build') {
    body += onboarding + '\n';
  } else {
    body += play + '\n';
  }

  if (characterBrief) {
    body += `\n[CONTEXTO]\n${characterBrief}\n`;
  }

  return body;
}

function buildMessages({ state, historyMsgs = [], userText = '', suggestMode = false }) {
  const sys = buildSystemFor(state);
  const messages = [{ role: 'system', content: sys }];

  // Reglas específicas por fase (refuerzo)
  if (state === 'onboarding:name') {
    messages.push({
      role: 'system',
      content:
        'Fase actual: onboarding:name. Pide únicamente el NOMBRE. No menciones especie ni rol. ' +
        'Si el usuario ya escribió un nombre, repítelo y emite confirmación en control.confirms=[{type:"name",name:"..."}]. ' +
        'No avances de fase hasta confirmación positiva. Nada de bloques de código ni ` ``` `.'
    });
  }
  if (state === 'onboarding:build') {
    messages.push({
      role: 'system',
      content:
        'Fase actual: onboarding:build. Pide únicamente ESPECIE y ROL. No vuelvas a tratar el nombre. ' +
        'Si el usuario ya escribió especie y rol, repítelos y emite confirmación en control.confirms=[{type:"build",species:"...",role:"..."}]. ' +
        'No avances de fase hasta confirmación positiva. Nada de bloques de código ni ` ``` `.'
    });
  }

  if (suggestMode) {
    messages.push({
      role: 'system',
      content:
        'El usuario ha pedido sugerencias. Ofrécelas de forma SUTIL: máximo 2 posibilidades, sin listas largas, sin bullets. ' +
        'Mantén el foco en la fase actual.'
    });
  }

  // Histórico (breve; para onboarding basta poco)
  const trimmed = (historyMsgs || []).slice(-8);
  for (const m of trimmed) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text || '').slice(0, 2000) });
  }

  if (userText && String(userText).trim()) {
    messages.push({ role: 'user', content: String(userText).trim() });
  }

  return messages;
}

async function callOpenAI({ state, userText, historyMsgs, suggestMode }) {
  const openai = await getOpenAI();
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';
  const messages = buildMessages({ state, userText, historyMsgs, suggestMode });

  const t0 = Date.now();
  const resp = await openai.chat.completions.create({
    model,
    messages,
    temperature: state === 'onboarding:name' ? 0.5 : state === 'onboarding:build' ? 0.6 : 0.9,
    max_tokens: 700
  });
  const t1 = Date.now();

  const text = resp?.choices?.[0]?.message?.content || '';
  const rid = resp?.id || '(no-id)';

  console.log('[DM][OpenAI]', { model, latency_ms: t1 - t0, openai_id: rid, head: firstLine(text).slice(0, 160) });

  return text;
}

/* =========================
 * Rutas (solo NUEVO usuario)
 * ========================= */

/**
 * Arranque de onboarding para usuario NUEVO
 * Crea thread en 'onboarding:name' y devuelve el primer mensaje del Máster (pedir nombre).
 */
router.post('/kickoff', requireAuth, async (req, res) => {
  try {
    if (!hasDb) return res.status(500).json({ ok: false, error: 'db_unavailable' });
    const userId = toInt(req.auth.userId);

    const thread = await getOrCreateOnboardingThread(userId);
    const character = await getOrCreateCharacterForUser(userId);
    if (!thread.character_id) await linkThreadCharacter(thread.id, character.id);

    // Carga un histórico MUY corto (si existiera)
    const hist = await sql(
      `SELECT role, text
         FROM chat_messages
        WHERE user_id = $1 AND thread_id = $2
        ORDER BY ts ASC
        LIMIT 8`,
      [userId, toInt(thread.id)]
    );

    const suggestMode = false;
    const modelText = await callOpenAI({
      state: 'onboarding:name',
      userText: 'Inicia la conversación de bienvenida y pide ÚNICAMENTE el nombre del personaje.',
      historyMsgs: hist.rows || [],
      suggestMode
    });

    const head = parseHeadJSON(modelText);
    if (!head) {
      console.warn('[DM/kickoff] HEAD JSON parse FAIL');
      return res.status(422).json({ ok: false, error: 'invalid_model_output' });
    }

    // Persistimos mensaje del Máster
    await saveChat(userId, thread.id, 'assistant', modelText);

    return res.json({ ok: true, text: modelText, state: 'onboarding:name', thread_id: thread.id, character_id: character.id });
  } catch (e) {
    console.error('[DM/kickoff] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'kickoff_failed' });
  }
});

/**
 * Mensajes del usuario durante el onboarding (NUEVO usuario).
 * - Respeta el estado del thread (name/build)
 * - Entiende "sugerir/sugerencia" para activar sugerencias sutiles
 * - No avanza de fase (eso lo hace /confirm)
 */
router.post('/respond', requireAuth, async (req, res) => {
  try {
    if (!hasDb) return res.status(500).json({ ok: false, error: 'db_unavailable' });

    const userId = toInt(req.auth.userId);
    const { message = '' } = req.body || {};

    // Thread + state actual
    const th = await getOrCreateOnboardingThread(userId);
    const state = th.state || 'onboarding:name';

    // Guardamos turno del usuario
    if (String(message || '').trim()) {
      await saveChat(userId, th.id, 'user', String(message).trim());
    }

    // Histórico breve
    const hist = await sql(
      `SELECT role, text
         FROM chat_messages
        WHERE user_id = $1 AND thread_id = $2
        ORDER BY ts ASC
        LIMIT 8`,
      [userId, toInt(th.id)]
    );

    const suggestMode = wantsSuggestion(message);
    const modelText = await callOpenAI({
      state,
      userText: message,
      historyMsgs: hist.rows || [],
      suggestMode
    });

    const head = parseHeadJSON(modelText);
    if (!head) {
      console.warn('[DM/respond] HEAD JSON parse FAIL');
      return res.status(422).json({ ok: false, error: 'invalid_model_output' });
    }

    await saveChat(userId, th.id, 'assistant', modelText);

    return res.json({ ok: true, text: modelText, state, thread_id: th.id });
  } catch (e) {
    console.error('[DM/respond] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'respond_failed' });
  }
});

/**
 * Confirmaciones de onboarding (botón "Sí" / "No").
 * El frontend debe llamar aquí cuando el usuario pulsa un botón de confirmación.
 *
 * Payload esperado:
 * {
 *   "thread_id": 123,
 *   "confirm": { "type":"name", "name":"Kara Voss" }    // Fase 1
 *   // o
 *   "confirm": { "type":"build", "species":"Humana", "role":"Contrabandista" }  // Fase 2
 *   "accept": true | false   // true = "Sí", false = "No"
 * }
 */
router.post('/confirm', requireAuth, async (req, res) => {
  try {
    if (!hasDb) return res.status(500).json({ ok: false, error: 'db_unavailable' });

    const userId = toInt(req.auth.userId);
    const { thread_id, confirm, accept } = req.body || {};
    if (!thread_id || !confirm || typeof accept !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    // Cargamos thread + personaje
    const thQ = await sql(
      `SELECT id, user_id, character_id, state
         FROM story_threads
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [toInt(thread_id), userId]
    );
    const th = thQ.rows[0];
    if (!th) return res.status(404).json({ ok: false, error: 'thread_not_found' });

    const ch = await getOrCreateCharacterForUser(userId);
    if (!th.character_id) await linkThreadCharacter(th.id, ch.id);

    const state = th.state || 'onboarding:name';

    // Si el usuario dice "No": no persistimos, no cambiamos de fase.
    if (!accept) {
      await saveChat(userId, th.id, 'user', '<<CONFIRM:NO>>');
      // Re-preguntar en la MISMA fase:
      const hist = await sql(
        `SELECT role, text
           FROM chat_messages
          WHERE user_id = $1 AND thread_id = $2
          ORDER BY ts ASC
          LIMIT 8`,
        [userId, toInt(th.id)]
      );

      const modelText = await callOpenAI({
        state,
        userText: 'El usuario ha rechazado. Reformula brevemente y vuelve a pedir la información de esta fase (sin avanzar).',
        historyMsgs: hist.rows || [],
        suggestMode: false
      });
      const head = parseHeadJSON(modelText);
      if (!head) return res.status(422).json({ ok: false, error: 'invalid_model_output' });

      await saveChat(userId, th.id, 'assistant', modelText);
      return res.json({ ok: true, text: modelText, state, thread_id: th.id, character_id: ch.id });
    }

    // Si "Sí": persistimos y avanzamos de fase cuando corresponda
    await saveChat(userId, th.id, 'user', '<<CONFIRM:YES>>');

    if (state === 'onboarding:name') {
      if (confirm.type !== 'name' || !confirm.name || !String(confirm.name).trim()) {
        return res.status(422).json({ ok: false, error: 'invalid_confirm_payload' });
      }

      await sql(
        `UPDATE characters
            SET name = $2,
                updated_at = now()
          WHERE id = $1`,
        [toInt(ch.id), String(confirm.name).trim()]
      );

      await setThreadState(th.id, 'onboarding:build');

      // Preguntar ESPECIE+ROL
      const hist = await sql(
        `SELECT role, text
           FROM chat_messages
          WHERE user_id = $1 AND thread_id = $2
          ORDER BY ts ASC
          LIMIT 8`,
        [userId, toInt(th.id)]
      );

      const modelText = await callOpenAI({
        state: 'onboarding:build',
        userText: 'Nombre confirmado. Pide ÚNICAMENTE especie y rol. Repite lo que el usuario diga y pide confirmación.',
        historyMsgs: hist.rows || [],
        suggestMode: false
      });
      const head = parseHeadJSON(modelText);
      if (!head) return res.status(422).json({ ok: false, error: 'invalid_model_output' });

      await saveChat(userId, th.id, 'assistant', modelText);

      return res.json({
        ok: true,
        text: modelText,
        state: 'onboarding:build',
        thread_id: th.id,
        character_id: ch.id
      });
    }

    if (state === 'onboarding:build') {
      if (confirm.type !== 'build' || !confirm.species || !confirm.role) {
        return res.status(422).json({ ok: false, error: 'invalid_confirm_payload' });
      }

      await sql(
        `UPDATE characters
            SET species = $2,
                role = $3,
                updated_at = now()
          WHERE id = $1`,
        [toInt(ch.id), String(confirm.species).trim(), String(confirm.role).trim()]
      );

      // Aquí podríamos pasar a 'play' y generar el primer mensaje del juego.
      // Como pediste centrarnos en "usuario nuevo", devolvemos el OK con el state ya listo para usar en el siguiente paso del flujo.
      await setThreadState(th.id, 'play');

      return res.json({
        ok: true,
        state: 'play',
        thread_id: th.id,
        character_id: ch.id,
        message: 'Onboarding completado. Personaje listo para empezar la historia.'
      });
    }

    // Si llega aquí en otro estado, devolvemos error controlado
    return res.status(409).json({ ok: false, error: 'invalid_state' });
  } catch (e) {
    console.error('[DM/confirm] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'confirm_failed' });
  }
});

/* Exporta router */
export default router;
