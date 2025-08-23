import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { pool, migrate } from './db.js';

await migrate();

export async function register(username, pin) {
  const name = (username || '').trim();
  if (!name) throw new Error('username required');
  if (!/^\d{4}$/.test(pin || '')) throw new Error('pin must be 4 digits');

  const exists = await pool.query('SELECT 1 FROM users WHERE lower(username)=lower($1)', [name]);
  if (exists.rowCount) throw new Error('user exists');

  const id = nanoid();
  const pinHash = await bcrypt.hash(pin, 10);
  await pool.query('INSERT INTO users (id, username, pin_hash) VALUES ($1,$2,$3)', [id, name, pinHash]);
  return { id, username: name };
}

export async function login(username, pin) {
  const name = (username || '').trim();
  const row = await pool.query('SELECT id, pin_hash FROM users WHERE lower(username)=lower($1)', [name]);
  if (!row.rowCount) throw new Error('invalid credentials');
  const user = row.rows[0];
  const ok = await bcrypt.compare(pin || '', user.pin_hash);
  if (!ok) throw new Error('invalid credentials');

  const token = nanoid(48);
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, user.id]);
  return { token, user: { id: user.id, username: name } };
}

async function authFromHeader(req) {
  const hdr = req.headers['authorization'] || '';
  if (!hdr.startsWith('Bearer ')) return null;
  const token = hdr.slice(7);
  const row = await pool.query(
    'SELECT s.token, s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > now())',
    [token]
  );
  if (!row.rowCount) return null;
  const rowData = row.rows[0];
  return { token: rowData.token, userId: rowData.user_id, username: rowData.username };
}

export async function requireAuth(req, res, next) {
  const a = await authFromHeader(req);
  if (!a) return res.status(401).json({ error: 'unauthorized' });
  req.auth = a;
  next();
}

export async function optionalAuth(req, _res, next) {
  const a = await authFromHeader(req);
  if (a) req.auth = a;
  next();
}
