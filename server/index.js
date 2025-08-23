import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { register, login, requireAuth, optionalAuth } from './auth.js';
import { getWorld, upsertCharacter, appendEvent } from './world.js';
import { dmRespond, narrateOutcome } from './dm.js';

// --- Helpers: knowledge gating for asking about other characters ---
function normalizeName(str){ return (str||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim(); }
function sameZone(a,b){
  if(!a||!b) return false;
  const A = (a.split('—')[0]||a).trim().toLowerCase();
  const B = (b.split('—')[0]||b).trim().toLowerCase();
  return !!A && !!B && A === B;
}
function pickLastPublicEvent(world, actor){
  const evts = (world.events||[]).filter(e => e.actor === actor && e.visibility !== 'private');
  evts.sort((x,y)=> (y.ts||0) - (x.ts||0));
  return evts[0] || null;
}
function reachScore(askerChar, targetChar, lastEvt){
  let score = 0;
  if(askerChar?.lastLocation && targetChar?.lastLocation){
    if (askerChar.lastLocation === targetChar.lastLocation) score += 2;
    else if (sameZone(askerChar.lastLocation, targetChar.lastLocation)) score += 1;
  }
  if (lastEvt){
    const age = Date.now() - (lastEvt.ts||0);
    if (age < 1000*60*60*72) score += 1; // <72h recency bonus
  }
  return score;
}
function buildAskAboutText({ asker, target, lastEvt, level }){
  const who = target?.name || 'desconocido';
  if (!target) return `No encuentro registros de **${who}** en los archivos del gremio.`;
  const bio = `**${target.name}** — ${target.species||target.race||'—'} ${target.role||target.clazz||''}`.trim();
  if (level === 'deny') return `La información sobre ${who} está fuera de tu alcance ahora mismo. Tal vez necesites contacto o presencia en la zona adecuada.`;
  if (level === 'bio') return `Registros básicos: ${bio}. Sin actividad reciente a tu alcance.`;
  if (level === 'rumor'){
    if (lastEvt) return `Circula un rumor sobre ${bio}. Última pista: en **${lastEvt.location}** — ${lastEvt.summary}.`;
    return `Hay rumores sobre ${bio}, pero nada concreto.`;
  }
  // full
  if (lastEvt) return `Datos verificados: ${bio}. Fue visto en **${lastEvt.location}** — ${lastEvt.summary}.`;
  return `Datos verificados: ${bio}.`;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(optionalAuth);

const PORT = process.env.PORT || 3001;
// --- Auth ---
app.post('/api/auth/register', (req, res) => {
  const { username, pin } = req.body || {};
  try {
    const user = register(username, pin);
    const { token } = login(username, pin);
    res.json({ ok: true, token, user });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'register failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, pin } = req.body || {};
  try {
    const { token, user } = login(username, pin);
    res.json({ ok: true, token, user });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'login failed' });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.auth) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, user: { id: req.auth.userId, username: req.auth.username } });
});


app.get('/api/world', (req, res) => res.json(getWorld()));

app.post('/api/world/characters', requireAuth, (req, res) => {
  const { character } = req.body || {};
  character.ownerUserId = req.auth.userId;
  if (!character?.name) return res.status(400).json({ error: 'character.name required' });
  const saved = upsertCharacter(character);
  res.json({ ok: true, character: saved });
});

app.post('/api/world/events', requireAuth, (req, res) => {
  const { actor, location = 'Ubicación desconocida', summary, visibility = 'public' } = req.body || {};
  const userId = req.auth?.userId;
  if (!actor || !summary) return res.status(400).json({ error: 'actor and summary required' });
  appendEvent({ ts: Date.now(), actor, location, summary, visibility, userId });
  res.json({ ok: true });
});


// Ask about another character (with gating)
app.post('/api/world/ask-about', requireAuth, (req, res) => {
  const { targetName } = req.body || {};
  if (!targetName) return res.status(400).json({ error: 'targetName required' });
  const world = getWorld();
  const asker = Object.values(world.characters || {}).find(c => c.ownerUserId === req.auth.userId) || null;

  const targetKey = Object.keys(world.characters || {}).find(k => normalizeName(k) === normalizeName(targetName));
  const target = targetKey ? world.characters[targetKey] : null;

  if (!target) return res.json({ text: `No encuentro registros de **${targetName}**.` });

  const lastEvt = pickLastPublicEvent(world, target.name);
  const score = reachScore(asker, target, lastEvt);
  let level = 'deny'; // deny | bio | rumor | full

  if (target.publicProfile) {
    if (score >= 2) level = 'full';
    else if (lastEvt) level = 'rumor';
    else level = 'bio';
  } else {
    if (score >= 2 && lastEvt) level = 'rumor';
    else if (score >= 1 && lastEvt) level = 'rumor';
    else level = 'deny';
  }

  const text = buildAskAboutText({ asker, target, lastEvt, level });
  res.json({ text, level, lastEvt });
});
app.post('/api/dm/respond', requireAuth, async (req, res) => {
  const { message, history = [], character } = req.body || {};
  try {
    const text = await dmRespond({ history, message, character, world: getWorld() });
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'dm failed' });
  }
});

app.post('/api/roll', requireAuth, async (req, res) => {
  const { skill, character, location, visibility = 'public' } = req.body || {};
  const r = Math.random();
  const outcome = r < 0.42 ? 'success' : r < 0.78 ? 'mixed' : 'fail';
  const text = narrateOutcome({ outcome, skill, character });
  try {
    const actor = character?.name || 'Desconocido';
    const loc = location || character?.lastLocation || 'Sector desconocido';
    const summary = outcome === 'success' ? `logró su objetivo` : outcome === 'mixed' ? `consiguió algo con complicación` : `fracasó en el intento`;
    appendEvent({ ts: Date.now(), actor, location: loc, summary: `${summary}${skill ? ` (${skill})` : ''}`, visibility, userId: req.auth.userId });
  } catch {}
  res.json({ outcome, text });
});

app.listen(PORT, () => console.log(`API http://localhost:${PORT}`));


// Get my character (by ownerUserId)
app.get('/api/world/characters/me', requireAuth, (req, res) => {
  const world = getWorld();
  const me = Object.values(world.characters || {}).find(c => c.ownerUserId === req.auth.userId);
  res.json({ ok: true, character: me || null });
});
