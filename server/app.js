// server/app.js - Configuración de Express
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import dmRouter from './dm.js';
import worldRouter from './world/index.js';
import chatRouter from './chat.js';
import {
  register,
  login,
  logout,
  getSession,
  requireAdmin,
  listUsers,
  deleteUserCascade,
  updateUser,
} from './auth.js';
import adminRouter from './routes/admin.js';
import { getOpenAI } from './openai-client.js';
import { sql, hasDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
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
  
  // Cookie parser para autenticación
  let cookieParser = null;
  try {
    const cp = await import('cookie-parser');
    cookieParser = cp.default || cp;
    app.use(cookieParser());
    console.log('[BOOT] cookie-parser loaded');
  } catch (e) {
    console.warn('[BOOT] cookie-parser not available:', e?.message);
  }

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

  /* ====== Auth Middleware ====== */
  // Middleware personalizado que lee tanto cookies como headers
  async function requireAuth(req, res, next) {
    console.log('[AUTH/requireAuth] Request received');
    console.log('[AUTH/requireAuth] Cookies:', req.cookies);
    console.log('[AUTH/requireAuth] Headers:', req.headers);
    
    // Intentar leer token de cookie primero, luego de header
    const cookieToken = req.cookies?.sid;
    const headerMatch = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    const headerToken = headerMatch ? headerMatch[1] : null;
    
    const token = cookieToken || headerToken;
    console.log('[AUTH/requireAuth] cookieToken:', cookieToken ? cookieToken.slice(0, 8) + '...' : 'none');
    console.log('[AUTH/requireAuth] headerToken:', headerToken ? headerToken.slice(0, 8) + '...' : 'none');
    console.log('[AUTH/requireAuth] final token:', token ? token.slice(0, 8) + '...' : 'none');
    
    if (!token) {
      console.warn('[AUTH/requireAuth] no token found');
      return res.status(401).json({ error: 'unauthorized' });
    }
    
    try {
      console.log('[AUTH/requireAuth] Getting session for token...');
      const session = await getSession(token);
      console.log('[AUTH/requireAuth] Session result:', session);
      
      if (!session) {
        console.warn('[AUTH/requireAuth] invalid token');
        return res.status(401).json({ error: 'unauthorized' });
      }
      
      req.auth = { userId: session.user_id, username: session.username, token };
      console.log('[AUTH/requireAuth] Auth set:', req.auth);
      console.log('[AUTH/requireAuth] user=', session.username, 'id=', session.user_id);
      next();
    } catch (e) {
      console.error('[AUTH/requireAuth] error', e);
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  /* ====== Auth ====== */
  api.post('/auth/register', async (req, res) => {
    console.log('[AUTH/register] Request received');
    console.log('[AUTH/register] Headers:', req.headers);
    console.log('[AUTH/register] Body:', req.body);
    try {
      const { username, pin } = req.body || {};
      console.log('[AUTH/register] Extracted username:', username, 'pin:', pin);
      
      console.log('[AUTH/register] Calling register function...');
      await register(username, pin);
      console.log('[AUTH/register] Register successful, calling login...');
      
      const payload = await login(username, pin);
      console.log('[AUTH/register] Login successful, payload:', payload);
      
      console.log('[AUTH/register] Ensuring character...');
      await ensureCharacter(username);
      console.log('[AUTH/register] Character ensured');
      
      // Configurar cookie HttpOnly para producción
      console.log('[AUTH/register] Setting cookie...');
      res.cookie('sid', payload.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV !== 'development',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
      });
      console.log('[AUTH/register] Cookie set');
      
      const response = { ok: true, user: payload.user };
      console.log('[AUTH/register] Sending response:', response);
      return res.json(response);
    } catch (e) {
      console.error('[AUTH/register] Error occurred:', e);
      console.error('[AUTH/register] Error message:', e.message);
      console.error('[AUTH/register] Error stack:', e.stack);
      return res.status(400).json({ error: e.message || 'error' });
    }
  });

  api.post('/auth/login', async (req, res) => {
    console.log('[AUTH/login] Request received');
    console.log('[AUTH/login] Headers:', req.headers);
    console.log('[AUTH/login] Body:', req.body);
    try {
      const { username, pin } = req.body || {};
      console.log('[AUTH/login] Extracted username:', username, 'pin:', pin);
      
      console.log('[AUTH/login] Calling login function...');
      const r = await login(username, pin);
      console.log('[AUTH/login] Login successful, result:', r);
      
      console.log('[AUTH/login] Ensuring character...');
      await ensureCharacter(username);
      console.log('[AUTH/login] Character ensured');
      
      // Configurar cookie HttpOnly para producción
      console.log('[AUTH/login] Setting cookie...');
      res.cookie('sid', r.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV !== 'development',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
      });
      console.log('[AUTH/login] Cookie set');
      
      const response = { ok: true, user: r.user };
      console.log('[AUTH/login] Sending response:', response);
      return res.json(response);
    } catch (e) {
      console.error('[AUTH/login] Error occurred:', e);
      console.error('[AUTH/login] Error message:', e.message);
      console.error('[AUTH/login] Error stack:', e.stack);
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
      // Limpiar cookie
      res.clearCookie('sid', { path: '/' });
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

  return app;
}
