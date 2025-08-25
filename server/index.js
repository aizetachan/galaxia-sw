// server/index.js
import express from 'express';
import { hasDb, sql } from './db.js';
import { register, login, requireAuth, logout } from './auth.js';
import worldRouter from './world.js';
import dmRouter from './dm.js';

const app = express();

/* CORS universal */
app.use((req,res,next)=>{
  const origin=req.headers.origin||'*';
  res.setHeader('Access-Control-Allow-Origin', origin==='null' ? '*' : origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit:'1mb' }));

/* Health SIEMPRE 200 */
app.get('/',(_req,res)=>res.type('text/plain').send('OK: API running. Prueba /health'));
app.get('/health', async(_req,res)=>{
  const out={ ok:true, ts:new Date().toISOString(), db:{ ok:false } };
  try{
    if(hasDb){ const t0=Date.now(); await sql('SELECT 1'); out.db={ ok:true, latencyMs:Date.now()-t0 }; }
    else out.db={ ok:false, reason:'missing DATABASE_URL' };
  }catch(e){ out.db={ ok:false, error:String(e.message||e) }; }
  res.status(200).json(out);
});

/* Auth */
app.post('/auth/register', async(req,res)=>{
  try{ const {username,pin}=req.body||{}; const user=await register(username,pin); const {token}=await login(username,pin);
       res.json({ ok:true, token, user }); }
  catch(e){ const map={ INVALID_CREDENTIALS:400, USERNAME_TAKEN:409 }; res.status(map[e.message]||500).json({ ok:false, error:e.message }); }
});
app.post('/auth/login', async(req,res)=>{
  try{ const {username,pin}=req.body||{}; const {token,user}=await login(username,pin); res.json({ ok:true, token, user }); }
  catch(e){ const map={ INVALID_CREDENTIALS:400, USER_NOT_FOUND:404, INVALID_PIN:401 }; res.status(map[e.message]||500).json({ ok:false, error:e.message }); }
});
app.get('/auth/me', requireAuth, async(req,res)=>{
  try{ const { rows }=await sql(`SELECT * FROM characters WHERE owner_user_id=$1 LIMIT 1`,[req.auth.userId]);
       res.json({ ok:true, user:{ id:req.auth.userId, username:req.auth.username }, character:rows[0]||null }); }
  catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/auth/logout', requireAuth, async(req,res)=>{
  try{ await logout(req.auth.token); res.json({ ok:true }); }
  catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

/* Rutas de juego */
app.use('/', dmRouter);
app.use('/', worldRouter);

/* Start (Vercel serverless ignora el puerto, no pasa nada) */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`API on :${PORT}`));
