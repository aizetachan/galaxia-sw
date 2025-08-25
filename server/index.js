// server/index.js
import express from 'express';
import { hasDb, sql } from './db.js';
import { register, login, requireAuth } from './auth.js';
import worldRouter from './world.js';
import dmRouter from './dm.js';

const app = express();

/* ===== CORS (antes de TODO) ===== */
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ===== Parsers ===== */
app.use(express.text({ type: ['text/plain', 'text/*'], limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

/* ===== Helpers para registrar rutas en / y /api ===== */
function dualGet(path, handler) {
  app.get(path, handler);
  app.get('/api' + (path === '/' ? '' : path), handler);
}
function dualPost(path, handler) {
  app.post(path, handler);
  app.post('/api' + path, handler);
}

/* ===== Root & health (siempre 200) ===== */
dualGet('/', (_req, res) => res.type('text/plain').send('OK: API running. Prueba /health'));
dualGet('/health', (_req, res) => res.status(200).json({ ok: true, ts: new Date().toISOString() }));

/* ===== (opcional) Estado de DB real ===== */
dualGet('/db/health', async (_req, res) => {
  const out = { ok: false };
  try {
    if (hasDb) {
      const t0 = Date.now();
      await sql('SELECT 1');
      out.ok = true;
      out.latencyMs = Date.now() - t0;
    } else {
      out.reason = 'missing DATABASE_URL';
    }
  } catch (e) {
    out.error = String(e?.message || e);
  }
  res.status(200).json(out);
});

/* ===== AI health (GPT-5 compatible) ===== */
dualGet('/ai/health', async (_req, res) => {
  const out = { ok: false, model: process.env.OPENAI_MODEL || 'gpt-5-mini' };
  try {
    const mod = await import('openai');
    const OpenAI = mod.default || mod.OpenAI || mod;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const payload = {
      model: out.model,
      messages: [
        { role: 'system', content: 'ping' },
        { role: 'user', content: 'ping' }
      ]
    };
    // tokens pequeños para ping, configurables
    const healthTokens = Number(process.env.AI_HEALTH_TOKENS || 8);
    if (/^gpt-5/i.test(out.model)) payload.max_completion_tokens = healthTokens;

    await client.chat.completions.create(payload);
    out.ok = true;
  } catch (e) {
    out.error = String(e?.message || e);
  }
  res.status(200).json(out);
});

/* ===== Auth (registramos /... y /api/...) ===== */
async function handleRegister(req, res) {
  try {
    const { username, pin } = req.body || {};
    const user = await register(username, pin);
    const { token } = await login(username, pin);
    res.json({ ok: true, token, user });
  } catch (e) {
    const map = { INVALID_CREDENTIALS: 400, USERNAME_TAKEN: 409 };
    res.status(map[e.message] || 500).json({ ok: false, error: e.message });
  }
}
async function handleLogin(req, res) {
  try {
    const { username, pin } = req.body || {};
    const { token, user } = await login(username, pin);
    res.json({ ok: true, token, user });
  } catch (e) {
    const map = { INVALID_CREDENTIALS: 400, USER_NOT_FOUND: 404, INVALID_PIN: 401 };
    res.status(map[e.message] || 500).json({ ok: false, error: e.message });
  }
}
async function handleMe(req, res) {
  try {
    const { rows } = await sql(`SELECT * FROM characters WHERE owner_user_id=$1 LIMIT 1`, [req.auth.userId]);
    res.json({ ok: true, user: { id: req.auth.userId, username: req.auth.username }, character: rows[0] || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
// Soft logout: conserva la fila y mata la sesión adelantando expires_at
async function handleLogout(req, res) {
  try {
    if (hasDb && req.auth?.token) {
      await sql(`UPDATE sessions SET expires_at = now() WHERE token = $1`, [req.auth.token]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

dualPost('/auth/register', handleRegister);
dualPost('/auth/login', handleLogin);
dualPost('/auth/logout', requireAuth, handleLogout);
dualGet('/auth/me', requireAuth, handleMe);

/* ===== Routers de juego montados también en /api ===== */
// /dm y /dm/respond
app.use('/', dmRouter);
app.use('/api', dmRouter);

// world.js (si expone rutas)
app.use('/', worldRouter);
app.use('/api', worldRouter);

/* ===== Stub provisional para /api/notes (evita 404 si el front lo llama) ===== */
app.get('/api/notes', (_req, res) => {
  res.json({ ok: true, items: [] }); // reemplaza por tu lógica real cuando la tengáis
});

/* ===== Error handler ===== */
app.use((err, req, res, _next) => {
  try {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  } catch {}
  if (!res.headersSent) res.status(500).json({ ok: false, error: String(err?.message || err) });
});

/* ===== Start (local) ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
