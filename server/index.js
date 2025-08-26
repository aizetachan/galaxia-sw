// server/index.js
import express from 'express';
import cors from 'cors';

import dmRouter from './dm.js';               // /respond, etc.
import worldRouter from './world.js';         // /world/..., /characters/...
import chatRouter from './chat.js';
import { register, login, requireAuth } from './auth.js';

const app = express();

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
  console.warn('[BOOT] morgan not available, using fallback logger. Reason:', e?.message);
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
    // Permite same-origin (sin header Origin) y, si no hay lista, abre para dev
    if (!origin) return cb(null, true);
    if (!ALLOWED.length || ALLOWED.includes(origin)) return cb(null, true);
    console.warn('[CORS] blocked:', origin, 'Allowed=', ALLOWED);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOpts));
app.options('*', cors(corsOpts)); // preflight

/* ====== Salud (en /health y /api/health) ====== */
function healthPayload() {
  return {
    ok: true,
    ts: Date.now(),
    env: process.env.NODE_ENV || 'production',
    api: { routes: 'mounted' },
  };
}
app.get('/health', (_req, res) => res.json(healthPayload()));
app.head('/health', (_req, res) => res.status(200).end());
app.get('/api/health', (_req, res) => res.json(healthPayload()));
app.head('/api/health', (_req, res) => res.status(200).end());

/* ====== Auth (todas bajo /api/auth/*) ====== */
app.post('/api/auth/register', async (req, res) => {
  console.log('[AUTH/register] body=', req.body);
  try {
    const { username, pin } = req.body || {};
    const user = await register(username, pin);
    return res.json(user);
  } catch (e) {
    console.error('[AUTH/register] error', e);
    return res.status(400).json({ error: e.message || 'error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  console.log('[AUTH/login] body=', req.body);
  try {
    const { username, pin } = req.body || {};
    const r = await login(username, pin);
    return res.json(r);
  } catch (e) {
    console.error('[AUTH/login] error', e);
    return res.status(400).json({ error: e.message || 'error' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  console.log('[AUTH/me] uid=', req.auth.userId, 'user=', req.auth.username);
  return res.json({ user: { id: req.auth.userId, username: req.auth.username } });
});

app.post('/api/auth/logout', requireAuth, async (_req, res) => {
  try {
    return res.json({ ok: true });
  } catch (e) {
    console.error('[AUTH/logout] error', e);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

/* ====== DM y World ====== */
// DM queda exactamente igual (expectativa del front: /api/dm/respond)
app.use('/api/dm', dmRouter);

// 🔧 IMPORTANTE: montamos worldRouter en /api (no en /api/world)
// Porque dentro del router usamos prefijos /world/... y /characters/...
// Resultado final: /api/world/..., /api/characters/:id/state, etc.
app.use('/api', worldRouter);
app.use('/api/chat', chatRouter);

/* ====== Tiradas demo ====== */
app.post('/api/roll', async (req, res) => {
  const { skill } = req.body || {};
  const n = Math.floor(Math.random() * 20) + 1;
  const outcome = n >= 11 ? 'success' : 'fail';
  const text = `Tirada (${skill || 'Acción'}): ${n} → ${outcome === 'success' ? 'éxito' : 'fallo'}.`;
  console.log('[ROLL]', { skill, n, outcome });
  return res.json({ ok: true, roll: n, outcome, text });
});

/* ====== Raíz opcional ====== */
app.get('/', (_req, res) => res.type('text/plain').send('OK'));

/* ====== 404 en /api/* ====== */
app.use('/api', (req, res) => {
  console.warn('[API 404]', req.method, req.originalUrl);
  return res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

/* ====== Manejador global de errores ====== */
app.use((err, req, res, _next) => {
  console.error('[API ERROR]', err?.stack || err?.message || err);
  return res.status(500).json({ error: 'internal_server_error' });
});

export default app;
