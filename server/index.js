// server/index.js
import express from 'express';
import cors from 'cors';
import pg from 'pg';

import dmRouter from './dm.js';               // /respond, etc.
import worldRouter from './world/index.js';   // /world/..., /characters/...
import chatRouter from './chat.js';
import {
  register,
  login,
  requireAuth,
  requireAdmin,
  listUsers,
  deleteUserCascade,
  updateUser,
} from './auth.js';
import adminRouter from './routes/admin.js';

const app = express();
const api = express.Router();

/* ====== DB helper para auto-provisión de personaje ====== */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon / Vercel
});
async function ensureCharacter(username) {
  if (!username) return;
  try {
    await pool.query('SELECT public.ensure_active_character($1)', [username]);
  } catch (e) {
    console.warn('[ensureCharacter] warning:', e?.message || e);
  }
}

/* ====== Logging básico ====== */
app.use((req, _res, next) => {
  console.log(
    '[REQ]',
    req.method,
    req.url,
    'Origin=',
    req.headers.origin || '-',
    'UA=',
    req.headers['user-agent'] || '-'
  );
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

/* ====== CORS (único bloque) ====== */
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
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH', 'PUT', 'DELETE'],
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
api.get('/health', (_req, res) => res.json(healthPayload()));
api.head('/health', (_req, res) => res.status(200).end());

/* ====== Auth (todas bajo /api/auth/*) ====== */
api.post('/auth/register', async (req, res) => {
  console.log('[AUTH/register] body=', req.body);
  try {
    const { username, pin } = req.body || {};
    await register(username, pin);                 // crea usuario
    const payload = await login(username, pin);    // auto-login -> { token, user }
    await ensureCharacter(username);               // auto-provisión personaje + seed
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
    await ensureCharacter(username);               // garantiza personaje activo + seed
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

api.post('/auth/logout', requireAuth, async (_req, res) => {
  try {
    return res.json({ ok: true });
  } catch (e) {
    console.error('[AUTH/logout] error', e);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

/* ====== Admin ====== */
api.get('/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await listUsers();
    return res.json({ users });
  } catch (e) {
    console.error('[ADMIN/users] error', e);
    return res.status(500).json({ error: e?.message || 'error' });
  }
});

api.put('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, pin } = req.body || {};
  await updateUser(id, { username, pin });
  return res.json({ ok: true });
});

api.delete('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.auth.userId) return res.status(400).json({ error: 'cannot_delete_self' });
  await deleteUserCascade(id);
  return res.json({ ok: true });
});

api.use('/admin', requireAuth, requireAdmin, adminRouter);

/* ====== DM y World ====== */
// DM (front espera /api/dm/respond)
api.use('/dm', dmRouter);

// Montamos worldRouter directamente: crea /api/world/... y /api/characters/...
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

/* ====== Raíz opcional ====== */
app.get('/', (_req, res) => res.type('text/plain').send('OK'));

/* ====== 404 en /api/* ====== */
app.use(['/api', '/api/v1'], (req, res) => {
  console.warn('[API 404]', req.method, req.originalUrl);
  return res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

/* ====== Manejador global de errores ====== */
app.use((err, req, res, _next) => {
  console.error('[API ERROR]', err?.stack || err?.message || err);
  return res.status(500).json({ error: 'internal_server_error' });
});

export default app;
