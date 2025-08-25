// server/index.js
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import dmRouter from './dm.js';               // /respond, etc.
import worldRouter from './world.js';         // /characters, ...
import { register, login, requireAuth } from './auth.js';

const app = express();

// ====== Logging y parsing ======
app.use((req, _res, next) => {
  console.log('[BOOT] incoming', req.method, req.url, 'Origin=', req.headers.origin);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// ====== CORS ======
const ALLOWED = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);
// Si no hay ALLOWED_ORIGIN, abrimos para desarrollo
const corsOpts = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!ALLOWED.length || ALLOWED.includes(origin)) return cb(null, true);
    console.warn('[CORS] blocked:', origin, 'Allowed=', ALLOWED);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOpts));
app.options('*', cors(corsOpts));

// ====== Salud (en /health y /api/health) ======
function healthPayload() {
  return { ok: true, ts: Date.now(), env: process.env.NODE_ENV || 'production' };
}
app.get('/health', (_req, res) => res.json(healthPayload()));
app.get('/api/health', (_req, res) => res.json(healthPayload()));

// ====== Auth (todas bajo /api/auth/*) ======
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

// Logout opcional (no borra histórico, solo sesión si quieres)
app.post('/api/auth/logout', requireAuth, async (_req, res) => {
  try {
    // Si quieres invalidar token en DB, hazlo aquí.
    return res.json({ ok: true });
  } catch (e) {
    console.error('[AUTH/logout] error', e);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

// ====== DM y World (bajo /api/*) ======
app.use('/api/dm', dmRouter);
app.use('/api/world', worldRouter);

// ====== Tiradas ======
app.post('/api/roll', async (req, res) => {
  const { skill } = req.body || {};
  const n = Math.floor(Math.random() * 20) + 1;
  const outcome = n >= 11 ? 'success' : 'fail';
  const text = `Tirada (${skill || 'Acción'}): ${n} → ${outcome === 'success' ? 'éxito' : 'fallo'}.`;
  console.log('[ROLL]', { skill, n, outcome });
  return res.json({ ok: true, roll: n, outcome, text });
});

// ====== Raíz opcional ======
app.get('/', (_req, res) => res.type('text/plain').send('OK'));

export default app;
