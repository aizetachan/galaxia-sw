import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
  if (!fs.existsSync(SESS_FILE)) fs.writeFileSync(SESS_FILE, JSON.stringify({ sessions: {} }, null, 2));
}

function readUsers() { ensureFiles(); return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); }
function writeUsers(obj) { fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2), 'utf-8'); }
function readSessions() { ensureFiles(); return JSON.parse(fs.readFileSync(SESS_FILE, 'utf-8')); }
function writeSessions(obj) { fs.writeFileSync(SESS_FILE, JSON.stringify(obj, null, 2), 'utf-8'); }

export function register(username, pin) {
  ensureFiles();
  const db = readUsers();
  const name = (username || '').trim();
  if (!name) throw new Error('username required');
  if (!/^\d{4}$/.test(pin || '')) throw new Error('pin must be 4 digits');
  const exists = db.users.find(u => u.username.toLowerCase() === name.toLowerCase());
  if (exists) throw new Error('user exists');
  const id = nanoid();
  const hash = bcrypt.hashSync(pin, 10);
  const user = { id, username: name, pinHash: hash, createdAt: Date.now() };
  db.users.push(user);
  writeUsers(db);
  return { id, username: name };
}

export function login(username, pin) {
  ensureFiles();
  const db = readUsers();
  const name = (username || '').trim();
  const user = db.users.find(u => u.username.toLowerCase() === name.toLowerCase());
  if (!user) throw new Error('invalid credentials');
  const ok = bcrypt.compareSync(pin || '', user.pinHash);
  if (!ok) throw new Error('invalid credentials');
  const sessions = readSessions();
  // Create random token, associate with user
  const token = nanoid(48);
  sessions.sessions[token] = { userId: user.id, username: user.username, ts: Date.now() };
  writeSessions(sessions);
  return { token, user: { id: user.id, username: user.username } };
}

export function authFromHeader(req) {
  const hdr = req.headers['authorization'] || '';
  if (!hdr.startsWith('Bearer ')) return null;
  const token = hdr.slice(7);
  const sessions = readSessions();
  const session = sessions.sessions[token];
  if (!session) return null;
  return { token, userId: session.userId, username: session.username };
}

export function revoke(token) {
  const sessions = readSessions();
  delete sessions.sessions[token];
  writeSessions(sessions);
}

export function requireAuth(req, res, next) {
  const a = authFromHeader(req);
  if (!a) return res.status(401).json({ error: 'unauthorized' });
  req.auth = a;
  next();
}

export function optionalAuth(req, _res, next) {
  const a = authFromHeader(req);
  if (a) req.auth = a;
  next();
}
