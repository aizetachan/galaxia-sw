// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { migrate } from './db.js';
import { register, login, requireAuth, optionalAuth } from './auth.js';
import { getWorld, upsertCharacter, appendEvent, getCharacterByOwner } from './world.js';
import { dmRespond, narrateOutcome } from './dm.js';

// Ejecuta migraciones una vez al arranque (Neon/Postgres)
await migrate();

// ---------- Helpers (gating de conocimiento) ----------
function normalizeName(str) {
  return (str || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
function sameZone(a, b) {
  if (!a || !b) return false;
  const A = (a.split('—')[0] || a).trim().toLowerCase();
  const B = (b.split('—')[0] || b).trim().toLowerCase();
  return !!A && !!B && A === B;
}
function pickLastPublicEvent(world, actor) {
  const evts = (world.events || []).filter((e) => e.actor === actor && e.visibility !== 'private');
  evts.sort((x, y) => (y.ts || 0) - (x.ts || 0));
  return evts[0] || null;
}
function reachScore(askerChar, targetChar, lastEvt) {
  let score = 0;
  if (askerChar?.lastLocation && targetChar?.lastLocation) {
    if (askerChar.lastLocation === targetChar.lastLocation) score += 2;
    else if (sameZone(askerChar.lastLocation, targetChar.lastLocation)) score += 1;
  }
  if (lastEvt) {
    const age = Date.now() - (new Date(lastEvt.ts).getTime() || 0);
    if (age < 1000 * 60 * 60 * 72) score += 1; // <72h
  }
  return score;
}
function buildAskAboutText({ asker, target, lastEvt, level }) {
  const who = target?.name || 'desconocido';
  if (!target) return `No encuentro registros de **${who}** en los archivos del gremio.`;
  const bio = `**${target.name}** — ${target.species || target.race || '—'} ${target.role || target.clazz || ''}`.trim();
  if (level === 'deny') return `La información sobre ${who} está fuera de tu alcance ahora mismo. Necesitas presencia o contactos en la zona.`;
  if (level === 'bio') return `Registros básicos: ${bio}. Sin actividad reciente a tu alcance.`;
  if (level === 'rumor') {
    if (lastEvt) return `Rumor sobre ${bio}. Última pista: en **${lastEvt.location}** — ${lastEvt.summary}.`;
    return `Hay rumores sobre ${bio}, pero nada concreto.`;
  }
  if (lastEvt) return `Datos verificados: ${bio}. Visto en **${lastEvt.location}** — ${lastEvt.summary}.`;
  return `Datos verificados: ${bio}.`;
}

// ---------- App ----------
const app = express();
app.use(cors());
app.use(express.json());
app.use(optionalAuth);

// Ping opcional (útil para pruebas y healthchecks)
app.get('/', (_req, res) => res.type('text/plain').send('OK: API running. Prueba /api/world'));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- AUTH ----------
app.post('/api/auth/register', async (req, res) => {
  const { username, pin } = req.body || {};
  try {
    const user = await register(username, pin);
    const { token } = await login(username, pin);
    res.json({ ok: true, token, user });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'register failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, pin } = req.body || {};
  try {
    const { token, user } = await login(username, pin);
    res.json({ ok: true, token, user });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'login failed' });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.auth) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, user: { id: req.auth.userId, username: req.auth.username } });
});

// ---------- WORLD ----------
app.get('/api/world', async (_req, res) => {
  const world = await getWorld();
  res.json(world);
});

app.post('/api/world/characters', requireAuth, async (req, res) => {
  const { character } = req.body || {};
  if (!character?.name) return res.status(400).json({ error: 'character.name required' });
  character.ownerUserId = req.auth.userId;
  const saved = await upsertCharacter(character);
  res.json({ ok: true, character: saved });
});

app.post('/api/world/events', requireAuth, async (req, res) => {
  const { actor, location = 'Ubicación desconocida', summary, visibility = 'public' } = req.body || {};
  if (!actor || !summary) return res.status(400).json({ error: 'actor and summary required' });
  await appendEvent({ ts: Date.now(), actor, location, summary, visibility, userId: req.auth.userId });
  res.json({ ok: true });
});

app.get('/api/world/characters/me', requireAuth, async (req, res) => {
  const me = await getCharacterByOwner(req.auth.userId);
  res.json({ ok: true, character: me || null });
});

app.post('/api/world/ask-about', requireAuth, async (req, res) => {
  const { targetName } = req.body || {};
  if (!targetName) return res.status(400).json({ error: 'targetName required' });

  const world = await getWorld();
  const asker = Object.values(world.characters || {}).find((c) => c.ownerUserId === req.auth.userId) || null;

  const targetKey = Object.keys(world.characters || {}).find(
    (k) => normalizeName(k) === normalizeName(targetName)
  );
  const target = targetKey ? world.characters[targetKey] : null;
  if (!target) return res.json({ text: `No encuentro registros de **${targetName}**.` });

  const lastEvt = pickLastPublicEvent(world, target.name);
  const score = reachScore(asker, target, lastEvt);

  // deny | bio | rumor | full
  let level = 'deny';
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

// ---------- DM (Máster IA) ----------
app.post('/api/dm/respond', requireAuth, async (req, res) => {
  const { message, history = [], character } = req.body || {};
  try {
    const text = await dmRespond({ history, message, character, world: await getWorld() });
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'dm failed' });
  }
});

// ---------- Tiradas ----------
app.post('/api/roll', requireAuth, async (req, res) => {
  const { skill, character, location, visibility = 'public' } = req.body || {};
  const r = Math.random();
  const outcome = r < 0.42 ? 'success' : r < 0.78 ? 'mixed' : 'fail';
  const text = narrateOutcome({ outcome, skill, character });

  try {
    const actor = character?.name || 'Desconocido';
    const loc = location || character?.lastLocation || 'Sector desconocido';
    const summary =
      outcome === 'success'
        ? `logró su objetivo`
        : outcome === 'mixed'
        ? `consiguió algo con complicación`
        : `fracasó en el intento`;
    await appendEvent({
      ts: Date.now(),
      actor,
      location: loc,
      summary: `${summary}${skill ? ` (${skill})` : ''}`,
      visibility,
      userId: req.auth.userId
    });
  } catch (e) {
    console.error('appendEvent failed', e);
  }
  res.json({ outcome, text });
});

// ---------- Export para Vercel y listen local ----------
export default app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`API http://localhost:${PORT}`));
}
