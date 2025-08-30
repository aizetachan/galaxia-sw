// server/api/router.js
import express from 'express';
import dmRouter from '../dm.js'; // /respond, etc.
import worldRouter from '../world/index.js'; // /world/..., /characters/...
import chatRouter from '../chat.js';
import { register, login, requireAuth, logout } from '../auth.js';

const api = express.Router();

function healthPayload() {
  return {
    ok: true,
    ts: Date.now(),
    env: process.env.NODE_ENV || 'production',
    api: { routes: 'mounted' },
  };
}
api.get('/health', (_req, res) => res.json(healthPayload()));
api.head('/health', (_req, res) => res.status(200).end());

api.post('/auth/register', async (req, res) => {
  console.log('[AUTH/register] body=', req.body);
  try {
    const { username, pin } = req.body || {};
    await register(username, pin);
    const payload = await login(username, pin);
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

// DM remains at /api/dm/respond etc.
api.use('/dm', dmRouter);

// mount worldRouter directly; it defines its own prefixes
api.use(worldRouter);
api.use('/chat', chatRouter);

api.post('/roll', async (req, res) => {
  const { skill } = req.body || {};
  const n = Math.floor(Math.random() * 20) + 1;
  const outcome = n >= 11 ? 'success' : 'fail';
  const text = `Tirada (${skill || 'Acción'}): ${n} → ${outcome === 'success' ? 'éxito' : 'fallo'}.`;
  console.log('[ROLL]', { skill, n, outcome });
  return res.json({ ok: true, roll: n, outcome, text });
});

export default api;
