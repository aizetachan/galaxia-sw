// server/auth.js
import { randomUUID, createHash } from 'crypto';
import { hasDb, sql } from './db.js';

/* Utilidades */
const now = () => new Date();
const addDays = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);

function normalizeUsername(username = '') {
  const u = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(u)) return null; // sólo letras/números/_
  return u;
}
function normalizePin(pin = '') {
  const p = String(pin).trim();
  if (!/^\d{4}$/.test(p)) return null; // 4 dígitos
  return p;
}
function hashPin(username, pin) {
  // Hash sencillo (sha256) con "sal" basada en username
  return createHash('sha256').update(`${username}:${pin}`).digest('hex');
}

/* Fallback en memoria para desarrollo si no hay DB */
const mem = {
  users: new Map(),      // username -> { id, username, pin_hash, created_at }
  sessions: new Map(),   // token -> { token, user_id, created_at, expires_at }
};
let memId = 1;

/* Persistencia */
async function dbFindUserByUsername(username) {
  if (!hasDb) return mem.users.get(username) || null;
  const { rows } = await sql(`SELECT id, username, pin_hash, created_at FROM users WHERE username=$1 LIMIT 1`, [username]);
  return rows[0] || null;
}
async function dbInsertUser(username, pin_hash) {
  if (!hasDb) {
    if (mem.users.has(username)) throw new Error('USERNAME_TAKEN');
    const user = { id: memId++, username, pin_hash, created_at: now() };
    mem.users.set(username, user);
    return user;
  }
  try {
    const { rows } = await sql(
      `INSERT INTO users (username, pin_hash) VALUES ($1,$2) RETURNING id, username, pin_hash, created_at`,
      [username, pin_hash]
    );
    return rows[0];
  } catch (e) {
    // Violación de UNIQUE en username
    if (String(e.message || '').toLowerCase().includes('unique')) {
      throw new Error('USERNAME_TAKEN');
    }
    throw e;
  }
}
async function dbCreateSession(user_id) {
  const token = randomUUID().replace(/-/g, '');
  const created_at = now();
  const expires_at = addDays(30);
  if (!hasDb) {
    mem.sessions.set(token, { token, user_id, created_at, expires_at });
    return { token, user_id, created_at, expires_at };
  }
  await sql(
    `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)`,
    [token, user_id, created_at, expires_at]
  );
  return { token, user_id, created_at, expires_at };
}
async function dbGetSession(token) {
  if (!token) return null;
  if (!hasDb) {
    const s = mem.sessions.get(token);
    if (!s) return null;
    if (s.expires_at && s.expires_at < now()) return null;
    const user = [...mem.users.values()].find(u => u.id === s.user_id) || null;
    if (!user) return null;
    return { token: s.token, user_id: s.user_id, username: user.username };
  }
  const { rows } = await sql(
    `SELECT s.token, s.user_id, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token=$1 AND (s.expires_at IS NULL OR s.expires_at > now())
      LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

/* API de autenticación */
export async function register(usernameRaw, pinRaw) {
  const username = normalizeUsername(usernameRaw);
  const pin = normalizePin(pinRaw);
  if (!username || !pin) throw new Error('INVALID_CREDENTIALS');

  const exists = await dbFindUserByUsername(username);
  if (exists) throw new Error('USERNAME_TAKEN');

  const pin_hash = hashPin(username, pin);
  const user = await dbInsertUser(username, pin_hash);
  return { id: user.id, username: user.username };
}

export async function login(usernameRaw, pinRaw) {
  const username = normalizeUsername(usernameRaw);
  const pin = normalizePin(pinRaw);
  if (!username || !pin) throw new Error('INVALID_CREDENTIALS');

  const user = await dbFindUserByUsername(username);
  if (!user) throw new Error('USER_NOT_FOUND');

  const ok = user.pin_hash === hashPin(username, pin);
  if (!ok) throw new Error('INVALID_PIN');

  const session = await dbCreateSession(user.id);
  return {
    token: session.token,
    user: { id: user.id, username: user.username },
  };
}

/* Middlewares */
export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : null;

  const s = await dbGetSession(token);
  if (!s) return res.status(401).json({ error: 'unauthorized' });

  req.auth = { userId: s.user_id, username: s.username, token: token };
  next();
}

export async function optionalAuth(req, _res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1] : null;
    if (!token) return next();
    const s = await dbGetSession(token);
    if (s) req.auth = { userId: s.user_id, username: s.username, token };
  } catch {}
  next();
}
