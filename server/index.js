// server/index.js
import express from 'express';
import { sql } from './db.js';
import { register, login, requireAuth, logout } from './auth.js';

const app = express();

/* ========== CORS universal (antes de TODO) ========== */
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  // Permitimos cualquier origen (no usamos cookies). Si quieres, cambia '*' por tu dominio.
  res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // OJO: si algún día usas cookies/sesiones del navegador, activa también:
  // res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ========== Body parser ========== */
app.use(express.json({ limit: '1mb' }));

/* ========== Raíz y salud ========== */
app.get('/', (_req, res) => {
  res.type('text/plain').send('OK: API running. Prueba /health');
});

app.get('/health', async (_req, res) => {
  try {
    const t0 = Date.now();
    await sql('SELECT 1');
    res.json({ ok: true, db: { ok: true, latencyMs: Date.now() - t0 } });
  } catch (e) {
    res.status(500).json({ ok: false, db: { ok: false, error: e.message } });
  }
});

/* ========== Auth mínimas ========== */
// POST /auth/register { username, pin }
app.post('/auth/register', async (req, res) => {
  try {
    const { username, pin } = req.body || {};
    const user = await register(username, pin);
    res.json({ ok: true, user });
  } catch (e) {
    const map = {
      INVALID_CREDENTIALS: 400,
      USERNAME_TAKEN: 409,
    };
    res.status(map[e.message] || 500).json({ ok: false, error: e.message });
  }
});

// POST /auth/login { username, pin }
app.post('/auth/login', async (req, res) => {
  try {
    const { username, pin } = req.body || {};
    const { token, user } = await login(username, pin);
    res.json({ ok: true, token, user });
  } catch (e) {
    const map = {
      INVALID_CREDENTIALS: 400,
      USER_NOT_FOUND: 404,
      INVALID_PIN: 401,
    };
    res.status(map[e.message] || 500).json({ ok: false, error: e.message });
  }
});

// GET /auth/me  (Bearer <token>)
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await sql(
      `SELECT * FROM characters WHERE owner_user_id=$1 LIMIT 1`,
      [req.auth.userId]
    );
    res.json({
      ok: true,
      user: { id: req.auth.userId, username: req.auth.username },
      character: rows[0] || null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /auth/logout
app.post('/auth/logout', requireAuth, async (req, res) => {
  try {
    await logout(req.auth.token);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== (Opcional) monta tus otras rutas aquí ========== */
// import worldRouter from './world.js';
// app.use('/', worldRouter);

/* ========== Start ========== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API on :${PORT}`);
});
