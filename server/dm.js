// server/dm.js
import { Router } from 'express';
import { hasDb, sql } from './db.js';
import { optionalAuth } from './auth.js';
import { getPrompt, getPromptSection } from './prompts.js';
import { getOpenAI } from './openai-client.js';
import {
  getNotes,
  setNotes,
  getSummary,
  setSummary,
  bumpTurns,
  SUMMARY_EVERY_TURNS,
  SUMMARY_HISTORY_TRIGGER,
  userLightNotes,
  userThreadSummary,
  userTurnCount,
} from './memory.js';

const router = Router();
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

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

const dicePolicy = getPrompt('dice-rules.md') || [
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

/* ========= PIN & SYSTEM ========= */
function buildSystem({ stage, brief, historyLines, isIntroStart, clientState }) {
  // === Secciones del prompt maestro (solo lo necesario por fase)
  const output = getPromptSection('prompt-master.md', 'OUTPUT_CONTRACT');
  const style  = getPromptSection('prompt-master.md', 'STYLE');
  const phase  = (stage && stage !== 'done')
    ? getPromptSection('prompt-master.md', 'ONBOARDING')
    : getPromptSection('prompt-master.md', 'PLAY');

  const game = getPrompt('game-rules.md');
  const dice = (stage === 'done') ? getPrompt('dice-rules.md') : '';

  // --- PIN (memoria activa, 3 líneas) ---
  const pinCanon = 'CANON: Space-opera PG-13; la reputación tiene consecuencias; la violencia pública atrae a la ley.';
  
  // PJ: intenta sacarlo del brief (DB) o cae al clientState (guest)
  let pinPj = '';
  const mPj = /PJ:\s*([^\n]+)/i.exec(brief || '');
  if (mPj) {
    pinPj = 'PJ: ' + mPj[1].trim();
  } else if (clientState?.name) {
    const spec = clientState?.species || '—';
    const role = clientState?.role || '—';
    pinPj = `PJ: ${clientState.name} (${spec}/${role})`;
  }

  const pinStage =
    (stage && stage !== 'done')
      ? `STAGE=${stage}`
      : 'STAGE=done';

  const pinClock = 'RITMO: narración breve (2–5 frases) y decisiones con impacto.';

  const pinBlock = [pinCanon, pinPj, pinStage, pinClock].filter(Boolean).join('\n');

  // Mundo cercano (DB) y resumen reciente
  const worldBlock = brief ? ('\nContexto del mundo:\n' + brief) : '';
  const historyBlock = (historyLines && historyLines.length)
    ? ('\nLíneas recientes:\n' + historyLines.map(s => '- ' + s).join('\n'))
    : '';

  // Contrato mínimo para cabecera JSON (refuerzo)
  const metaContract = [
    'CONTRATO DE SALIDA:',
    '- La PRIMERA LÍNEA debe ser JSON válido con exactamente esta forma:',
    '  {"ui":{"narration":"...","choices":[{"id":"...","label":"...","requires":[],"hint":""}]},"control":{"state":"...","rolls":[],"memos":[],"confirms":[]}}',
    '- Todo lo interno (state, rolls, memos, confirms) va SOLO en "control".',
    '- "ui" es lo único que verá el jugador. No incluyas etiquetas <<...>> en "ui".',
    '- Máximo 3 opciones relevantes y divergentes.',
  ].join('\n');

  return [
    pinBlock,
    metaContract,
    output,
    style,
    phase,
    game,
    dice ? ('POLÍTICA DE DADOS (resumen):\n' + dice) : '',
    languagePolicy,
    dicePolicy,
    tagProtocol,
    isIntroStart ? introPolicy : '',
    worldBlock,
    historyBlock,
  ].filter(Boolean).join('\n\n');
}


/* ========= selector de MODO (fast/rich/auto) ========= */
const PASSIVE_RE = /\b(miro|observo|echo un vistazo|escucho|me quedo quiet[oa]|esperar|esperando|contemplo|analizo|reviso|vigilo)\b/i;

function pickMode({ body, query, lastUser }) {
  // 👇 ahora soporta body.config.mode (desde el frontend)
  const override = (body?.config?.mode || body?.mode || query?.mode || process.env.DM_MODE || '').toLowerCase();


  if (['fast', 'rich', 'auto'].includes(override)) return override || 'auto';
  if (PASSIVE_RE.test(lastUser || '')) return 'fast';
  if (/"[^"]+"/.test(lastUser || '') || /\b(corro|ataco|disparo|hackeo|negocio|amenazo|huyo|persuado)\b/i.test(lastUser || '')) return 'rich';
  return 'fast';
}
function paramsFor(mode) {
  return (mode === 'rich')
    ? { temperature: 0.8, top_p: 0.95, max_tokens: 520 }
    : { temperature: 0.6, top_p: 0.90, max_tokens: 280 };
}

/* ========= Asegurar cabecera JSON ========= */
function ensureJsonHeader(text){
  const s = String(text || '');
  const nl = s.indexOf('\n');
  const first = (nl >= 0 ? s.slice(0, nl) : s).trim();
  let ok = false;
  try {
    const j = JSON.parse(first);
    ok = !!(j && typeof j === 'object' && j.ui && j.control && 'narration' in j.ui && Array.isArray(j.ui.choices));
  } catch {}
  if (ok) return s;
  // Fallback mínimo para que el frontend siempre tenga estructura
  return `{"ui":{"narration":"","choices":[]},"control":{"state":"","rolls":[],"memos":[],"confirms":[]}}\n` + s;
}
/* ========= Formatear respuesta solo-UI (sin lógica) ========= */
function makeUiOnlyText(llmText) {
  const s = String(llmText || '');
  const nl = s.indexOf('\n');
  const header = (nl >= 0 ? s.slice(0, nl) : s).trim();
  const body   = (nl >= 0 ? s.slice(nl + 1) : '');

  let ui = null;
  try {
    const h = JSON.parse(header);
    ui = h?.ui || null;
  } catch {}

  const stripTags = (t) => String(t).replace(/<<[^>]+>>/g, '').trim();

  if (ui && typeof ui === 'object') {
    const narration = stripTags(ui.narration || '');
    const choices = Array.isArray(ui.choices) ? ui.choices : [];
    const bullets = choices.length
      ? '\n\n' + choices.map(c => '• ' + (c?.label ?? '')).join('\n')
      : '';
    return (narration + bullets).trim() || '…';
  }

  // Fallback: si no hubo cabecera JSON válida, devuelve el texto completo limpiando etiquetas
  return stripTags(s || body);
}


/* ========= OpenAI call ========= */
function isGpt5(model) { return /^gpt-5/i.test(model || ''); }

async function callOpenAI({ client, model, messages, params }) {
  // Chat Completions primero
  try {
    const payload = { model, messages };
    if (!isGpt5(model)) {
      const t = Number.isFinite(params?.temperature) ? params.temperature : Number(process.env.DM_TEMPERATURE ?? '0.9');
      if (Number.isFinite(t)) payload.temperature = t;
      if (Number.isFinite(params?.top_p)) payload.top_p = params.top_p;
      if (Number.isFinite(params?.max_tokens)) payload.max_tokens = params.max_tokens;
    }
    const resp = await client.chat.completions.create(payload);
    const out = resp.choices?.[0]?.message?.content?.trim() || null;
    if (out) return out;
  } catch (e) {
    const status = e?.status || e?.response?.status;
    if (![400, 422].includes(status)) throw e;
  }

  // Responses API fallback
  const r2 = await client.responses.create({
    model,
    input: messages,
    temperature: params?.temperature,
    top_p: params?.top_p,
    max_output_tokens: params?.max_tokens,
  });
  const out = r2.output_text || r2?.content?.[0]?.text || r2?.choices?.[0]?.message?.content || null;
  return (typeof out === 'string' && out.trim()) ? out.trim() : null;
}

/* ========= Resumen comprimido ========= */
async function summarizeTurn({ client, model, prevSummary, recentLines }) {
  const summarizerModel = process.env.OPENAI_SUMMARY_MODEL || model || 'gpt-5-mini';
  const sys = [
    'Eres un asistente que resume partidas de rol en español.',
    'Objetivo: producir un RESUMEN COMPRIMIDO (4–8 viñetas, máximo ~700 caracteres).',
    'Incluye: situación actual, objetivo inmediato, pistas/objetos clave, amenazas activas, cambios de estado del PJ.',
    'No inventes datos. No incluyas etiquetas <<...>>. Prioriza lo reciente.',
  ].join('\n');

  const user = [
    prevSummary ? `Resumen previo:\n${prevSummary}\n` : '',
    'Nuevas líneas recientes (en orden cronológico):',
    recentLines.map(l => '- ' + l).join('\n'),
    '',
    'Devuelve solo viñetas (•) en texto plano, 4–8 líneas.'
  ].join('\n');

  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ];

  const out = await callOpenAI({
    client,
    model: summarizerModel,
    messages,
    params: { temperature: 0.3, top_p: 0.9, max_tokens: 380 },
  });

  return String(out || '')
    .replace(/<<[\s\S]*?>>/g, '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 10)
    .join('\n')
    .slice(0, 900);
}

async function maybeUpdateSummary({ userId, historyLines }) {
  const turns = bumpTurns(userId);
  const needs = (turns % SUMMARY_EVERY_TURNS === 0) || (historyLines.length >= SUMMARY_HISTORY_TRIGGER);
  if (!needs) return;

  try {
    const client = await getOpenAI();
    const prev = getSummary(userId);
    const recent = historyLines.slice(-24);
    const newSummary = await summarizeTurn({
      client,
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      prevSummary: prev,
      recentLines: recent,
    });
    if (newSummary && newSummary.length > 0) {
      setSummary(userId, newSummary);
      console.log('[DM] summary updated (chars=', newSummary.length, ')');
    }
  } catch (e) {
    console.warn('[DM] summary update skipped:', e?.message || e);
  }
}

/* ========= handler principal ========= */
async function handleDM(req, res) {
  const url = req.originalUrl || req.url;
  const userId = req.auth?.userId || null;
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

    const sceneMemo = Array.isArray(req.body?.clientState?.sceneMemo) ? req.body.clientState.sceneMemo : [];
    const lightNotes = getNotes(userId);
    const mergedMemo = [...new Set([...lightNotes, ...sceneMemo])].slice(-10);

    const summaryText = getSummary(userId);

    const memoBlock = mergedMemo.length
      ? `\n[RECORDATORIOS — NO narrar; solo tener en cuenta]\n- ${mergedMemo.join('\n- ')}\n`
      : '';
    const summaryBlock = summaryText ? `\n[RESUMEN BREVE DE SESIÓN]\n${summaryText}\n` : '';

    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
    const system = buildSystem({
      stage,
      brief,
      historyLines: history.lines,
      isIntroStart,
      clientState: req.body?.clientState || null,
    });

    // historia reciente del FRONT
    const clientHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const lastUserFromClient = clientHistory.slice().reverse().find(m => m.kind === 'user')?.text || text || '';

    const mode = pickMode({ body: req.body, query: req.query, lastUser: lastUserFromClient });
    const llmParams = paramsFor(mode);

    const messages = [
      { role: 'system', content: system },
      ...(summaryBlock ? [{ role: 'assistant', content: summaryBlock }] : []),
      ...(memoBlock ? [{ role: 'assistant', content: memoBlock }] : []),
      ...clientHistory.slice(-8).map(m => ({
        role: m.kind === 'user' ? 'user' : 'assistant',
        content: `${m.user}: ${m.text}`
      })),
      { role: 'user', content: text || '<<CLIENT_HELLO>>' },
    ];

    let outText = null;
    try {
      const client = await getOpenAI();
      outText = await callOpenAI({ client, model, messages, params: llmParams });
    } catch (e) {
      console.error('[DM] OpenAI fatal:', e?.status, e?.code, e?.message);
    }

    if (!outText) {
      const t = 'Interferencia en la HoloNet. El Máster no responde ahora mismo; repite la acción más tarde.';
      await saveMsg(userId, 'dm', t);
      return res.status(200).json({ ok: true, text: t, meta: { ai_ok: false, model, mode } });
    }

       // Asegurar JSON en primera línea
       let safeText = ensureJsonHeader(outText);

       // Extraer y guardar memo del encabezado JSON como “light notes”
       try {
         const nl = safeText.indexOf('\n');
         const first = (nl >= 0 ? safeText.slice(0, nl) : safeText).trim();
         const head = JSON.parse(first);
         const memos = head?.control?.memos;
         if (Array.isArray(memos) && memos.length) {
           const current = getNotes(userId);
           setNotes(userId, [...current, ...memos]);
         }
       } catch {}
   
       // Construye el texto visible para la UI (sin lógica)
       const uiText = makeUiOnlyText(safeText);
   
       // Guarda en histórico lo mismo que verá el jugador
       await saveMsg(userId, 'dm', uiText);
   
       try {
         await maybeUpdateSummary({
           userId,
           historyLines: history.lines,
         });
       } catch (e) {
         console.warn('[DM] maybeUpdateSummary error:', e?.message || e);
       }
   
       // Devuelve solo lo visible
       return res.status(200).json({ ok: true, text: uiText, meta: { ai_ok: true, model, mode } });
   

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
