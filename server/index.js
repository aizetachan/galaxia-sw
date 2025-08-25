// server/index.js
import express from 'express';
import { hasDb, sql } from './db.js';
import { register, login, requireAuth, logout } from './auth.js';
import worldRouter from './world.js';
import dmRouter from './dm.js';

const app = express();

/* ===== CORS universal (primero) ===== */
app.use((req,res,next)=>{
  const origin=req.headers.origin||'*';
  res.setHeader('Access-Control-Allow-Origin', origin==='null' ? '*' : origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

/* ===== Parsers ===== */
app.use(express.text({ type: ['text/plain','text/*'], limit:'1mb' }));
app.use(express.urlencoded({ extended:false, limit:'1mb' }));
app.use(express.json({ limit:'1mb' }));

/* ===== Root & Health (siempre 200) ===== */
app.get('/',(_req,res)=>res.type('text/plain').send('OK: API running. Prueba /health'));
app.get('/health', async(_req,res)=>{
  const out={ ok:true, ts:new Date().toISOString(), db:{ ok:false }, ai:{ ok:'unknown' } };
  try{
    if(hasDb){ const t0=Date.now(); await sql('SELECT 1'); out.db={ ok:true, latencyMs:Date.now()-t0 }; }
    else out.db={ ok:false, reason:'missing DATABASE_URL' };
  }catch(e){ out.db={ ok:false, error:String(e.message||e) }; }
  // No testeamos IA aquí para no gastar — usa /ai/health cuando quieras
  res.status(200).json(out);
});

/* ===== AI health check explícito (rápido) ===== */
app.get('/ai/health', async (_req, res) => {
  const out = { ok: false, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
  try {
    const mod = await import('openai');
    const OpenAI = mod.default || mod.OpenAI || mod;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // ping mínimo
    await client.chat.completions.create({
      model: out.model,
      messages: [{ role: 'system', content: 'ping' }, { role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
    out.ok = true;
    res.status(200).json(out);
  } catch (e) {
    out.error = String(e?.message || e);
    res.status(200).json(out); // 200 para que el front no marque FAIL
  }
});

/* ===== Auth ===== */
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

/* ===== Routers de juego ===== */
app.use('/', dmRouter);     // /dm y /dm/respond (IA primero)
app.use('/', worldRouter);

/* ===== Error handler (garantiza CORS en errores inesperados) ===== */
app.use((err, req, res, _next) => {
  try {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  } catch {}
  if (!res.headersSent) {
    res.status(500).json({ ok:false, error:String(err?.message||err) });
  }
});

/* ===== Start (local) ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`API on :${PORT}`));
