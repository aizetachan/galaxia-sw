const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { VertexAI } = require('@google-cloud/vertexai');

admin.initializeApp();
const db = admin.firestore();

const dmRouter = require('./dm');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-jwt-secret';
const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'galaxian-dae59';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'global';
const GEMINI_MODELS = (process.env.GEMINI_MODEL_LIST || process.env.GEMINI_MODEL || 'gemini-2.0-flash-001,gemini-1.5-flash-002,gemini-1.5-flash')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  if (String(h).startsWith('Bearer ')) return String(h).slice(7);
  return req.cookies?.token || null;
}

async function askGemini(prompt) {
  const vertexAI = new VertexAI({ project: VERTEX_PROJECT, location: VERTEX_LOCATION });
  let lastErr = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      const model = vertexAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: String(prompt || 'Hola') }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 512
        }
      });

      const text = result?.response?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim() || '';
      if (text) return { text, model: modelName };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No Gemini model available');
}

function auth(req, res, next) {
  try {
    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token requerido' });
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_e) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token inválido' });
  }
}

// Normalize /api/* when called via Hosting rewrite
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) req.url = req.url.slice(4) || '/';
  next();
});

app.get('/health', async (_req, res) => {
  res.json({ ok: true, ts: Date.now(), env: 'firebase', db: true, dbUrl: true });
});

app.get('/ai/config', auth, async (_req, res) => {
  return res.json({ ok: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION, models: GEMINI_MODELS });
});

app.post('/ai/test', auth, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || 'Di hola en una línea.');
    const out = await askGemini(prompt);
    return res.json({ ok: true, model: out.model, location: VERTEX_LOCATION, text: out.text });
  } catch (e) {
    console.error('[AI test]', e);
    return res.status(500).json({ ok: false, error: 'AI_ERROR', message: e?.message || 'Error calling Gemini' });
  }
});

app.post('/auth/register', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const pin = String(req.body?.pin || '').trim();

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({ ok: false, error: 'INVALID_USERNAME', message: 'Usuario inválido' });
    }
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ ok: false, error: 'INVALID_PIN', message: 'PIN inválido' });
    }

    const unameRef = db.collection('usernames').doc(username);
    const unameSnap = await unameRef.get();
    if (unameSnap.exists) {
      return res.status(409).json({ ok: false, error: 'USERNAME_TAKEN', message: 'Usuario ya existe' });
    }

    const userRef = db.collection('users').doc();
    const user = { id: userRef.id, username, pin_hash: hashPin(pin), created_at: Date.now(), last_login: Date.now() };

    const batch = db.batch();
    batch.set(userRef, user);
    batch.set(unameRef, { uid: userRef.id, username });
    await batch.commit();

    const token = makeToken(user);
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true, user: { id: user.id, username: user.username }, token, message: 'Usuario registrado' });
  } catch (e) {
    console.error('[AUTH register]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Error del servidor' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const pin = String(req.body?.pin || '').trim();

    const unameSnap = await db.collection('usernames').doc(username).get();
    if (!unameSnap.exists) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Usuario o PIN incorrectos' });
    }

    const uid = unameSnap.data().uid;
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Usuario o PIN incorrectos' });
    }

    const user = userSnap.data();
    if (user.pin_hash !== hashPin(pin)) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Usuario o PIN incorrectos' });
    }

    await db.collection('users').doc(uid).set({ last_login: Date.now() }, { merge: true });
    const token = makeToken({ id: uid, username: user.username });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true, user: { id: uid, username: user.username }, token, message: 'Login exitoso' });
  } catch (e) {
    console.error('[AUTH login]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Error del servidor' });
  }
});

app.post('/auth/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true, message: 'Logout ok' });
});

app.get('/auth/me', auth, (req, res) => {
  res.json({ ok: true, user: { id: req.user.id, username: req.user.username } });
});

app.get('/world/characters/me', auth, async (req, res) => {
  try {
    const snap = await db.collection('characters').doc(req.user.id).get();
    if (!snap.exists) return res.json({ ok: true, character: null });
    return res.json({ ok: true, character: snap.data() });
  } catch (e) {
    console.error('[WORLD me]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Error del servidor' });
  }
});

app.post('/world/characters', auth, async (req, res) => {
  try {
    const payload = req.body || {};
    const c = payload.character || payload;
    const character = {
      id: req.user.id,
      userId: req.user.id,
      name: c.name || payload.name || 'Aventurer@',
      species: c.species || payload.species || '',
      role: c.role || payload.role || '',
      publicProfile: typeof c.publicProfile === 'boolean' ? c.publicProfile : true,
      lastLocation: c.lastLocation || payload.lastLocation || 'Dock 7 de la estación orbital',
      updatedAt: Date.now(),
      createdAt: c.createdAt || Date.now()
    };

    await db.collection('characters').doc(req.user.id).set(character, { merge: true });
    return res.json({ ok: true, character, message: 'Personaje guardado' });
  } catch (e) {
    console.error('[WORLD save]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Error del servidor' });
  }
});

app.get('/chat/history', auth, async (req, res) => {
  try {
    const q = await db.collection('users').doc(req.user.id).collection('messages').orderBy('ts', 'asc').limit(300).get();
    const messages = q.docs.map(d => d.data());
    return res.json({ ok: true, messages });
  } catch (e) {
    console.error('[CHAT history]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Error del servidor' });
  }
});

app.get('/dm/resume', auth, (_req, res) => {
  return res.json({ ok: true, text: 'Resumen no implementado en v1 firebase.' });
});

// Persist minimal chat transcript around DM responses
app.use('/dm', auth, async (req, res, next) => {
  try {
    if (req.method === 'POST' && req.path === '/respond') {
      const msg = String(req.body?.message || '');
      if (msg && !msg.startsWith('<<')) {
        await db.collection('users').doc(req.user.id).collection('messages').add({
          role: 'user',
          text: msg,
          ts: new Date().toISOString()
        });
      }

      const originalJson = res.json.bind(res);
      res.json = async (payload) => {
        try {
          const text = payload?.text;
          if (text) {
            await db.collection('users').doc(req.user.id).collection('messages').add({
              role: 'dm',
              text,
              ts: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('[DM persist]', e);
        }
        return originalJson(payload);
      };
    }
    next();
  } catch (e) {
    console.error('[DM middleware]', e);
    next();
  }
}, dmRouter);

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found', path: req.path, method: req.method }));

exports.api = functions
  .region('europe-west1')
  .runWith({ serviceAccount: 'galaxian-dae59@appspot.gserviceaccount.com' })
  .https.onRequest(app);
