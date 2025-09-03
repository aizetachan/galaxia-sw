// server/index.js
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

import dmRouter from './dm.js';
import worldRouter from './world/index.js';
import chatRouter from './chat.js';
import {
  register,
  login,
  logout,
  requireAuth,
  requireAdmin,
  listUsers,
  deleteUserCascade,
  updateUser,
} from './auth.js';
import adminRouter from './routes/admin.js';
import { getOpenAI } from './openai-client.js';
import { sql, hasDb } from './db.js';

const app = express();
const api = express.Router();

/* ====== DB helper ====== */
async function ensureCharacter(username) {
  if (!username || !hasDb) return;
  try {
    await sql('SELECT public.ensure_active_character($1)', [username]);
  } catch (e) {
    console.warn('[ensureCharacter] warning:', e?.message || e);
  }
}

/* ====== Logging ====== */
app.use((req, _res, next) => {
  console.log('[REQ]', req.method, req.url, 'Origin=', req.headers.origin || '-', 'UA=', req.headers['user-agent'] || '-');
  next();
});

// morgan opcional
let morganMW = null;
try {
  const m = await import('morgan');
  morganMW = m.default || m;
  console.log('[BOOT] morgan loaded');
} catch (e) {
  console.warn('[BOOT] morgan not available:', e?.message);
}
if (morganMW) app.use(morganMW('tiny'));

/* ====== Parsing ====== */
app.use(express.json({ limit: '1mb' }));

/* ====== CORS ====== */
const ALLOWED = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOpts = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!ALLOWED.length || ALLOWED.includes(origin)) return cb(null, true);
    console.warn('[CORS] blocked:', origin, 'Allowed=', ALLOWED);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Token'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOpts));
app.options('*', cors(corsOpts));

/* ====== Health ====== */
function healthPayload() {
  return { ok: true, ts: Date.now(), env: process.env.NODE_ENV || 'production', api: { routes: 'mounted' } };
}
app.get('/health', (_req, res) => res.json(healthPayload()));
app.head('/health', (_req, res) => res.status(200).end());
api.get('/health', (_req, res) => res.json(healthPayload()));
api.head('/health', (_req, res) => res.status(200).end());

/* ====== Auth ====== */
api.post('/auth/register', async (req, res) => {
  console.log('[AUTH/register] body=', req.body);
  try {
    const { username, pin } = req.body || {};
    await register(username, pin);
    const payload = await login(username, pin);
    await ensureCharacter(username);
    return res.json(payload);
  } catch (e) {
    console.error('[AUTH/register] error', e);
    return res.status(400).json({ error: e.message || 'error' });
  }
});

api.post('/auth/login', async (req, res) => {
  console.log('[AUTH/login] body=', req.body);
  try {
    const { username, pin } = req.body || {};
    const r = await login(username, pin);
    await ensureCharacter(username);
    return res.json(r);
  } catch (e) {
    console.error('[AUTH/login] error', e);
    return res.status(400).json({ error: e.message || 'error' });
  }
});

api.get('/auth/me', requireAuth, async (req, res) => {
  console.log('[AUTH/me] uid=', req.auth.userId, 'user=', req.auth.username);
  return res.json({ user: { id: req.auth.userId, username: req.auth.username } });
});

api.post('/auth/logout', requireAuth, async (req, res) => {
  try {
    await logout(req.auth.token);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[AUTH/logout] error', e);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

/* ====== Admin ====== */
api.get('/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try { const users = await listUsers(); return res.json({ users }); }
  catch (e) { console.error('[ADMIN/users] error', e); return res.status(500).json({ error: e?.message || 'error' }); }
});

api.put('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params; const { username, pin } = req.body || {};
  await updateUser(id, { username, pin }); return res.json({ ok: true });
});

api.delete('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.auth.userId) return res.status(400).json({ error: 'cannot_delete_self' });
  await deleteUserCascade(id); return res.json({ ok: true });
});

api.use('/admin', requireAuth, requireAdmin, adminRouter);

/* ====== DM y World ====== */
api.use('/dm', dmRouter);
api.use(worldRouter);
api.use('/chat', chatRouter);

/* ====== Tiradas demo ====== */
api.post('/roll', async (req, res) => {
  const { skill } = req.body || {};
  const n = Math.floor(Math.random() * 20) + 1;
  const outcome = n >= 11 ? 'success' : 'fail';
  const text = `Tirada (${skill || 'Acción'}): ${n} → ${outcome === 'success' ? 'éxito' : 'fallo'}.`;
  console.log('[ROLL]', { skill, n, outcome });
  return res.json({ ok: true, roll: n, outcome, text });
});

/* ====== Montaje de routers ====== */
app.use('/api', api);
app.use('/api/v1', api);

/* ====== Raíz ====== */
app.get('/', (_req, res) => res.type('text/plain').send('OK'));

/* ====== Prompt builder ====== */
function buildSceneImagePrompt({ masterText = '', scene = {} }) {
  const location   = scene?.location   || 'sci-fi spaceport interior';
  const mood       = scene?.mood       || 'tense, cinematic';
  const action     = scene?.action     || 'two figures negotiating by a holographic console';
  const props      = scene?.props      || 'holographic panels, worn metal, vapor, distant ships';
  const characters = scene?.characters || 'two original humanoids with distinct silhouettes (no IP)';

  return [
    'You are a scene concept artist for a sci-fi chat-RPG.',
    'Create ONE original still image. No text overlays, watermarks or copyrighted characters/styles.',
    'Cinematic, realistic lighting, clean composition, readable silhouettes.',
    '',
    'Scene:',
    `- Location: ${location}`,
    `- Mood: ${mood}`,
    `- Action: ${action}`,
    `- Key props: ${props}`,
    `- Characters (original, no IP): ${characters}`,
    '',
    'Inspiration from the following description of what is happening:',
    JSON.stringify(String(masterText || '').slice(0, 1200))
  ].join('\n');
}

/* =======================================================================
   JOBS (start → worker → status)
   ======================================================================= */
globalThis.SCENE_JOBS = globalThis.SCENE_JOBS || new Map();
const JOBS = globalThis.SCENE_JOBS;

function gcJobs() {
  const now = Date.now();
  for (const [id, j] of JOBS.entries()) {
    if ((now - j.createdAt) > 30 * 60 * 1000) JOBS.delete(id);
  }
}
function newJob({ masterText, scene }) {
  const id = randomUUID();
  const rec = { id, status: 'queued', createdAt: Date.now(), masterText, scene: scene || null, dataUrl: null, error: null };
  JOBS.set(id, rec); gcJobs(); return rec;
}
const getJob = (id) => JOBS.get(id) || null;
const setJobDone  = (id, dataUrl) => { const j = JOBS.get(id); if (j) { j.status='done'; j.dataUrl=dataUrl; j.error=null; } };
const setJobError = (id, msg)     => { const j = JOBS.get(id); if (j) { j.status='error'; j.error=(msg||'unknown'); } };

/** 1) START */
api.post('/scene-image/start', requireAuth, async (req, res) => {
  try {
    const { masterText, scene } = req.body || {};
    const text = (typeof masterText === 'string' ? masterText.trim() : '');
    if (!text) return res.status(400).json({ error: 'masterText_required' });

    const job = newJob({ masterText: text, scene });

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const base  = `${proto}://${host}`;
    const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

    fetch(`${base}/api/scene-image/worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(INTERNAL_TOKEN ? { 'X-Internal-Token': INTERNAL_TOKEN } : {}) },
      body: JSON.stringify({ jobId: job.id }),
    }).catch(() => {});

    return res.status(202).json({ ok: true, jobId: job.id });
  } catch (e) {
    console.error('[scene-image/start]', e);
    return res.status(500).json({ error: 'start_failed' });
  }
});

/** 2) WORKER */
api.post('/scene-image/worker', async (req, res) => {
  const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
  if (INTERNAL_TOKEN && req.headers['x-internal-token'] !== INTERNAL_TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { jobId } = req.body || {};
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: 'job_not_found' });

    if (job.status === 'done')       return res.json({ ok: true, status: 'done' });
    if (job.status === 'processing') return res.json({ ok: true, status: 'processing' });
    job.status = 'processing';

    const openai = await getOpenAI();
    const prompt = buildSceneImagePrompt({ masterText: job.masterText, scene: job.scene });

    const out = await openai.images.generate({ model: 'gpt-image-1', size: '1024x1024', prompt });
    const d   = out?.data?.[0] || null;
    const b64 = d?.b64_json || null;
    const url = d?.url || null;
    const src = b64 ? `data:image/png;base64,${b64}` : url;

    if (!src) {
      setJobError(jobId, 'no_image_payload');
      return res.status(502).json({ error: 'no_image_payload' });
    }

    setJobDone(jobId, src);
    return res.json({ ok: true, status: 'done' });
  } catch (e) {
    console.error('[scene-image/worker]', e?.status || '', e?.message || e);
    const { jobId } = req.body || {};
    if (jobId) setJobError(jobId, e?.message || 'worker_failed');
    return res.status(500).json({ error: 'worker_failed' });
  }
});

/** 3) STATUS */
api.get('/scene-image/status', requireAuth, async (req, res) => {
  const jobId = String(req.query.jobId || '');
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: 'job_not_found' });

  return res.json({
    ok: true,
    status: job.status,
    dataUrl: job.status === 'done' ? job.dataUrl : null,
    error: job.status === 'error' ? job.error : null,
  });
});

/* ====== 404 ====== */
app.use(['/api', '/api/v1'], (req, res) => {
  console.warn('[API 404]', req.method, req.originalUrl);
  return res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

/* ====== Error handler ====== */
app.use((err, req, res, _next) => {
  console.error('[API ERROR]', err?.stack || err?.message || err);
  return res.status(500).json({ error: 'internal_server_error' });
});

export default app;

// If this file is executed directly (not imported), start the HTTP server.
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`[BOOT] listening on port ${PORT}`);
  });
}
