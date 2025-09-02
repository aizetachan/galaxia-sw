// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { requireAuth } from './auth.js';
import { getPromptSection } from './prompts.js';
import { getOpenAI } from './openai-client.js';

const router = Router();
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* ========= Schema helpers (autodetección) ========= */
const schemaCache = new Map();
async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (schemaCache.has(key)) return schemaCache.get(key);
  const q = await sql(
    `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    [table, column]
  );
  const ok = q.rows.length > 0;
  schemaCache.set(key, ok);
  return ok;
}
async function userCol(table) {
  if (await hasColumn(table, 'owner_user_id')) return 'owner_user_id';
  if (await hasColumn(table, 'user_id')) return 'user_id';
  return null;
}
async function chatHasUserId() { return await hasColumn('chat_messages', 'user_id'); }
async function storyHasCharacterId() { return await hasColumn('story_threads', 'character_id'); }

/* ========= Utils ========= */
function headLine(str = '') {
  const i = String(str || '').indexOf('\n');
  return i === -1 ? String(str || '') : String(str || '').slice(0, i);
}
function parseHeadJSON(text = '') {
  try {
    const head = headLine(text).trim();
    const j = JSON.parse(head);
    return j && j.ui && j.control ? j : null;
  } catch { return null; }
}
function wantsSuggestion(userMsg = '') {
  const t = String(userMsg || '').toLowerCase();
  return t === 'sugerir' || t === 'sugerencia' || t.includes('sugerir') || t.includes('sugerencia');
}

/* ========= DB helpers ========= */

// Devuelve { id, state, character_id? } del thread de onboarding del user o lo crea
async function getOrCreateOnboardingThread(userId) {
  if (!hasDb) throw new Error('DB not available');
  const uid = toInt(userId);

  const hasChar = await storyHasCharacterId();
  const charUser = await userCol('characters');
  const hasMsgUser = await chatHasUserId();

  let row;

  if (hasChar) {
    // story_threads.character_id EXISTE → podemos enlazar con characters
    let q = await sql(
      `
      SELECT st.id, st.state, st.character_id
        FROM story_threads st
        JOIN characters c ON c.id = st.character_id
        ${charUser ? `WHERE c.${charUser} = $1` : ''}
        ORDER BY st.updated_at DESC
        LIMIT 1
      `,
      charUser ? [uid] : []
    );
    row = q.rows[0];

    if (!row) {
      // Intento vía puente user_characters
      q = await sql(
        `
        SELECT st.id, st.state, st.character_id
          FROM story_threads st
          JOIN characters c ON c.id = st.character_id
          JOIN user_characters uc ON uc.character_id = c.id
         WHERE uc.user_id = $1
         ORDER BY st.updated_at DESC
         LIMIT 1
        `,
        [uid]
      );
      row = q.rows[0];
    }
  } else {
    // story_threads.character_id NO existe
    // Mejor intento: localizar por chat_messages.user_id si existe
    if (hasMsgUser) {
      const q = await sql(
        `
        SELECT st.id, st.state
          FROM story_threads st
          JOIN chat_messages cm ON cm.thread_id = st.id
         WHERE cm.user_id = $1
         ORDER BY st.updated_at DESC
         LIMIT 1
        `,
        [uid]
      );
      row = q.rows[0];
    } else {
      // Último recurso: ningún vínculo → no podemos asociar por usuario; crearemos uno nuevo
      row = null;
    }
  }

  if (row && row.state?.startsWith('onboarding')) return row;

  const ins = await sql(
    `INSERT INTO story_threads (state, updated_at)
     VALUES ('onboarding:name', now())
     RETURNING id, state${hasChar ? ', character_id' : ''}`
  );
  return ins.rows[0];
}

// Personaje del user (si existe); si no hay relación directa, crea uno y lo asocia por puente si existe
async function getOrCreateCharacterForUser(userId) {
  const uid = toInt(userId);
  const charUser = await userCol('characters');

  let q;
  if (charUser) {
    q = await sql(
      `SELECT id, ${charUser} AS owner, name, species, role
         FROM characters
        WHERE ${charUser} = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [uid]
    );
  } else {
    q = await sql(
      `SELECT c.id, null as owner, c.name, c.species, c.role
         FROM characters c
         JOIN user_characters uc ON uc.character_id = c.id
        WHERE uc.user_id = $1
        ORDER BY c.updated_at DESC
        LIMIT 1`,
      [uid]
    );
  }
  if (q.rows[0]) return q.rows[0];

  // Crear
  let ins;
  if (charUser) {
    ins = await sql(
      `INSERT INTO characters (${charUser}, updated_at)
       VALUES ($1, now())
       RETURNING id, ${charUser} AS owner, name, species, role`,
      [uid]
    );
  } else {
    ins = await sql(
      `INSERT INTO characters (updated_at)
       VALUES (now())
       RETURNING id, name, species, role`
    );
    try {
      await sql(
        `INSERT INTO user_characters (user_id, character_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [uid, ins.rows[0].id]
      );
    } catch {}
  }
  return ins.rows[0];
}

async function linkThreadCharacter(threadId, characterId) {
  if (!(await storyHasCharacterId())) return; // nada que enlazar
  await sql(
    `UPDATE story_threads
        SET character_id = $2,
            updated_at = now()
      WHERE id = $1`,
    [toInt(threadId), toInt(characterId)]
  );
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

async function loadShortHistory(threadId, limit = 8) {
  const q = await sql(
    `SELECT role, text
       FROM chat_messages
      WHERE thread_id = $1
      ORDER BY ts ASC
      LIMIT $2`,
    [toInt(threadId), limit]
  );
  return q.rows || [];
}

async function saveChat({ userId, threadId, role, text }) {
  const hasUser = await chatHasUserId();
  if (hasUser) {
    await sql(
      `INSERT INTO chat_messages (user_id, thread_id, role, text, ts)
       VALUES ($1, $2, $3, $4, now())`,
      [toInt(userId), toInt(threadId), role, text]
    );
  } else {
    await sql(
      `INSERT INTO chat_messages (thread_id, role, text, ts)
       VALUES ($1, $2, $3, now())`,
      [toInt(threadId), role, text]
    );
  }
}

/* ========= Prompts & OpenAI ========= */
function buildSystemFor(state) {
  const contract = getPromptSection('prompt-master.md', 'OUTPUT_CONTRACT');
  const style = getPromptSection('prompt-master.md', 'STYLE');
  const onboarding = getPromptSection('prompt-master.md', 'ONBOARDING');
  const play = getPromptSection('prompt-master.md', 'PLAY');

  let body = contract + '\n\n' + style + '\n\n';
  if (state === 'onboarding:name' || state === 'onboarding:build') body += onboarding + '\n';
  else body += play + '\n';
  return body;
}

function buildMessages({ state, historyMsgs = [], userText = '', suggestMode = false }) {
  const messages = [{ role: 'system', content: buildSystemFor(state) }];

  if (state === 'onboarding:name') {
    messages.push({
      role: 'system',
      content:
        'Fase: onboarding:name. Pide ÚNICAMENTE el NOMBRE. ' +
        'No menciones especie ni rol. Emite control.confirms=[{type:"name",name:"..."}]. ' +
        'No avances de fase. Sin bloques de código.'
    });
  }
  if (state === 'onboarding:build') {
    messages.push({
      role: 'system',
      content:
        'Fase: onboarding:build. Pide ÚNICAMENTE ESPECIE y ROL. ' +
        'No trates el nombre. Emite control.confirms=[{type:"build",species:"...",role:"..."}]. ' +
        'No avances de fase. Sin bloques de código.'
    });
  }
  if (suggestMode) {
    messages.push({
      role: 'system',
      content: 'El usuario pidió sugerencias. Ofrece MÁXIMO 2 opciones sutiles en el campo "options" del JSON.'
    });
  }

  for (const m of (historyMsgs || []).slice(-8)) {
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
    temperature: state.startsWith('onboarding') ? 0.5 : 0.9,
    max_tokens: 700
  });
  const t1 = Date.now();
  const text = resp?.choices?.[0]?.message?.content || '';
  console.log('[DM][OpenAI]', { model, latency_ms: t1 - t0, head: headLine(text).slice(0, 160) });
  return text;
}

/* ========= Rutas ONBOARDING ========= */

// Arranque explícito
router.post('/kickoff', requireAuth, async (req, res) => {
  try {
    if (!hasDb) return res.status(500).json({ ok: false, error: 'db_unavailable' });
    const userId = toInt(req.auth.userId);

    const thread = await getOrCreateOnboardingThread(userId);
    // Intentamos crear/obtener character, pero solo enlazamos si la columna existe
    const character = await getOrCreateCharacterForUser(userId);
    await linkThreadCharacter(thread.id, character.id);

    const hist = await loadShortHistory(thread.id);
    const modelText = await callOpenAI({
      state: 'onboarding:name',
      userText: 'Inicia la bienvenida y pide ÚNICAMENTE el nombre.',
      historyMsgs: hist,
      suggestMode: false
    });
    const head = parseHeadJSON(modelText);
    if (!head) return res.status(422).json({ ok: false, error: 'invalid_model_output' });

    await saveChat({ userId, threadId: thread.id, role: 'assistant', text: modelText });

    return res.json({ ok: true, text: modelText, state: 'onboarding:name', thread_id: thread.id, character_id: character.id });
  } catch (e) {
    console.error('[DM/kickoff] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'kickoff_failed' });
  }
});

// Mensajes del usuario
router.post('/respond', requireAuth, async (req, res) => {
  try {
    if (!hasDb) return res.status(500).json({ ok: false, error: 'db_unavailable' });
    const userId = toInt(req.auth.userId);
    const { message = '' } = req.body || {};

    const thread = await getOrCreateOnboardingThread(userId);
    const state = thread.state || 'onboarding:name';

    if (String(message || '').trim()) {
      await saveChat({ userId, threadId: thread.id, role: 'user', text: String(message).trim() });
    }

    const hist = await loadShortHistory(thread.id);
    const modelText = await callOpenAI({
      state,
      userText: message,
      historyMsgs: hist,
      suggestMode: wantsSuggestion(message)
    });
    const head = parseHeadJSON(modelText);
    if (!head) return res.status(422).json({ ok: false, error: 'invalid_model_output' });

    await saveChat({ userId, threadId: thread.id, role: 'assistant', text: modelText });

    return res.json({ ok: true, text: modelText, state, thread_id: thread.id });
  } catch (e) {
    console.error('[DM/respond] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'respond_failed' });
  }
});

// Confirmaciones (Sí/No)
router.post('/confirm', requireAuth, async (req, res) => {
  try {
    if (!hasDb) return res.status(500).json({ ok: false, error: 'db_unavailable' });

    const userId = toInt(req.auth.userId);
    const { thread_id, confirm, accept } = req.body || {};
    if (!thread_id || !confirm || typeof accept !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    const thQ = await sql(
      `SELECT id, state${await storyHasCharacterId() ? ', character_id' : ''}
         FROM story_threads
        WHERE id = $1
        LIMIT 1`,
      [toInt(thread_id)]
    );
    const th = thQ.rows[0];
    if (!th) return res.status(404).json({ ok: false, error: 'thread_not_found' });

    const ch = await getOrCreateCharacterForUser(userId);
    await linkThreadCharacter(th.id, ch.id);

    const state = th.state || 'onboarding:name';

    if (!accept) {
      await saveChat({ userId, threadId: th.id, role: 'user', text: '<<CONFIRM:NO>>' });
      const hist = await loadShortHistory(th.id);
      const modelText = await callOpenAI({
        state,
        userText: 'El usuario ha rechazado. Reformula y vuelve a pedir la info de esta fase (sin avanzar).',
        historyMsgs: hist,
        suggestMode: false
      });
      const head = parseHeadJSON(modelText);
      if (!head) return res.status(422).json({ ok: false, error: 'invalid_model_output' });
      await saveChat({ userId, threadId: th.id, role: 'assistant', text: modelText });
      return res.json({ ok: true, text: modelText, state, thread_id: th.id, character_id: ch.id });
    }

    await saveChat({ userId, threadId: th.id, role: 'user', text: '<<CONFIRM:YES>>' });

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

      const hist = await loadShortHistory(th.id);
      const modelText = await callOpenAI({
        state: 'onboarding:build',
        userText: 'Nombre confirmado. Pide ÚNICAMENTE especie y rol. Repite y pide confirmación.',
        historyMsgs: hist,
        suggestMode: false
      });
      const head = parseHeadJSON(modelText);
      if (!head) return res.status(422).json({ ok: false, error: 'invalid_model_output' });
      await saveChat({ userId, threadId: th.id, role: 'assistant', text: modelText });

      return res.json({ ok: true, text: modelText, state: 'onboarding:build', thread_id: th.id, character_id: ch.id });
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
      await setThreadState(th.id, 'play');

      return res.json({
        ok: true,
        state: 'play',
        thread_id: th.id,
        character_id: ch.id,
        message: 'Onboarding completado. Personaje listo.'
      });
    }

    return res.status(409).json({ ok: false, error: 'invalid_state' });
  } catch (e) {
    console.error('[DM/confirm] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'confirm_failed' });
  }
});

export default router;
