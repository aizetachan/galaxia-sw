// server/auth.js
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { hasDb, sql } from './db.js';

const now = () => new Date();
const addDays = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);

function normalizeUsername(username=''){ const u=String(username).trim().toLowerCase(); return /^[a-z0-9_]{3,24}$/.test(u)?u:null; }
function normalizePin(pin=''){ const p=String(pin).trim(); return /^\d{4}$/.test(p)?p:null; }

function hashPinV2(pin){ const salt=randomBytes(16).toString('hex'); const key=scryptSync(String(pin),salt,64).toString('hex'); return `v2:${salt}:${key}`; }
function verifyPinV2(pin, stored){ const parts=String(stored).split(':'); if(parts.length!==3||parts[0]!=='v2')return false; const[,salt,keyHex]=parts; const a=Buffer.from(keyHex,'hex'); const b=Buffer.from(scryptSync(String(pin),salt,64).toString('hex'),'hex'); return a.length===b.length && timingSafeEqual(a,b); }
function hashPinLegacy(username,pin){ return createHash('sha256').update(`${username}:${pin}`).digest('hex'); }

const mem={ users:new Map(), sessions:new Map() }; let memId=1;

async function dbFindUserByUsername(username){ if(!hasDb) return mem.users.get(username)||null;
  const {rows}=await sql(`SELECT id,username,pin_hash,created_at FROM users WHERE username=$1 LIMIT 1`,[username]); return rows[0]||null; }
async function dbInsertUser(username,pin_hash){ if(!hasDb){ if(mem.users.has(username)) throw new Error('USERNAME_TAKEN'); const u={id:memId++,username,pin_hash,created_at:now()}; mem.users.set(username,u); return u; }
  try{ const {rows}=await sql(`INSERT INTO users(username,pin_hash) VALUES ($1,$2) RETURNING id,username,pin_hash,created_at`,[username,pin_hash]); return rows[0]; }
  catch(e){ if(String(e.message||'').toLowerCase().includes('unique')) throw new Error('USERNAME_TAKEN'); throw e; } }
async function dbUpdateUserPinHash(userId,newHash){ if(!hasDb){ for(const u of mem.users.values()){ if(u.id===userId){u.pin_hash=newHash;break;} } return; }
  await sql(`UPDATE users SET pin_hash=$1 WHERE id=$2`,[newHash,userId]); }
async function dbCreateSession(user_id){ const token=randomUUID().replace(/-/g,''); const created_at=now(); const expires_at=addDays(30);
  if(!hasDb){ mem.sessions.set(token,{token,user_id,created_at,expires_at}); return {token,user_id,created_at,expires_at}; }
  await sql(`INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)`,[token,user_id,created_at,expires_at]);
  return {token,user_id,created_at,expires_at}; }
async function dbGetSession(token){ if(!token) return null;
  if(!hasDb){ const s=mem.sessions.get(token); if(!s|| (s.expires_at && s.expires_at<now())) return null; const user=[...mem.users.values()].find(u=>u.id===s.user_id)||null; if(!user) return null; return {token:s.token,user_id:s.user_id,username:user.username}; }
  const {rows}=await sql(
    `SELECT s.token,s.user_id,u.username FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token=$1 AND (s.expires_at IS NULL OR s.expires_at>now()) LIMIT 1`,[token]); return rows[0]||null; }
async function dbDeleteSession(token){ if(!token) return; if(!hasDb){ mem.sessions.delete(token); return; } await sql(`DELETE FROM sessions WHERE token=$1`,[token]); }

export async function register(usernameRaw,pinRaw){
  const username=normalizeUsername(usernameRaw); const pin=normalizePin(pinRaw);
  if(!username||!pin) throw new Error('INVALID_CREDENTIALS');
  const exists=await dbFindUserByUsername(username); if(exists) throw new Error('USERNAME_TAKEN');
  const pin_hash=hashPinV2(pin); const user=await dbInsertUser(username,pin_hash);
  return { id:user.id, username:user.username };
}

export async function login(usernameRaw,pinRaw){
  const username=normalizeUsername(usernameRaw); const pin=normalizePin(pinRaw);
  if(!username||!pin) throw new Error('INVALID_CREDENTIALS');
  const user=await dbFindUserByUsername(username); if(!user) throw new Error('USER_NOT_FOUND');
  let ok=false; const stored=user.pin_hash||'';
  if(stored.startsWith('v2:')) ok=verifyPinV2(pin,stored);
  else { ok = stored===hashPinLegacy(username,pin); if(ok&&hasDb){ try{ await dbUpdateUserPinHash(user.id,hashPinV2(pin)); } catch{} } }
  if(!ok) throw new Error('INVALID_PIN');
  const session=await dbCreateSession(user.id);
  return { token:session.token, user:{ id:user.id, username:user.username } };
}

export async function requireAuth(req,res,next){
  const m=(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
  const token=m?m[1]:null; const s=await dbGetSession(token);
  if(!s){
    const origin=req.headers.origin||'*';
    res.setHeader('Access-Control-Allow-Origin', origin==='null'?'*':origin);
    res.setHeader('Vary','Origin');
    return res.status(401).json({ error:'unauthorized' });
  }
  req.auth={ userId:s.user_id, username:s.username, token }; next();
}
export async function optionalAuth(req,_res,next){
  try{ const m=(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
    const token=m?m[1]:null; if(!token) return next(); const s=await dbGetSession(token);
    if(s) req.auth={ userId:s.user_id, username:s.username, token }; } catch {}
  next();
}
export async function getSession(token){ return dbGetSession(token); }
export async function logout(token){ await dbDeleteSession(token); return { ok:true }; }
