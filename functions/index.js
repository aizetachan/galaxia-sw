const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { VertexAI } = require('@google-cloud/vertexai');

let GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
try {
  if (!GEMINI_API_KEY) GEMINI_API_KEY = functions.config()?.gemini?.api_key || '';
} catch {}

admin.initializeApp();
const db = admin.firestore();

const dmRouter = require('./dm');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-jwt-secret';
const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'galaxian-dae59';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-pro-preview';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';

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

function normalizeAiError(e, model) {
  return {
    ok: false,
    error: 'AI_ERROR',
    message: e?.message || 'Vertex error',
    code: e?.code || null,
    status: e?.status || null,
    model,
    location: VERTEX_LOCATION,
    project: VERTEX_PROJECT
  };
}

async function askGemini(prompt) {
  const p = String(prompt || 'Hola');

  // Preferred override: API key path (Google AI API)
  if (GEMINI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_CHAT_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: p }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 512 }
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `Gemini API HTTP ${r.status}`);
    const text = j?.candidates?.[0]?.content?.parts?.map(x => x?.text || '').join(' ').trim() || '';
    return { text, model: GEMINI_CHAT_MODEL, transport: 'api_key' };
  }

  // Fallback: Vertex path
  const vertexAI = new VertexAI({ project: VERTEX_PROJECT, location: VERTEX_LOCATION });
  const model = vertexAI.getGenerativeModel({ model: GEMINI_CHAT_MODEL });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: p }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 512 }
  });

  const text = result?.response?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim() || '';
  return { text, model: GEMINI_CHAT_MODEL, transport: 'vertex' };
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
  return res.json({
    ok: true,
    project: VERTEX_PROJECT,
    location: VERTEX_LOCATION,
    chatModel: GEMINI_CHAT_MODEL,
    imageModel: GEMINI_IMAGE_MODEL,
    transport: GEMINI_API_KEY ? 'api_key' : 'vertex'
  });
});

app.post('/ai/test', auth, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || 'Di hola en una línea.');
    const out = await askGemini(prompt);
    return res.json({ ok: true, model: out.model, location: VERTEX_LOCATION, text: out.text });
  } catch (e) {
    console.error('[AI test]', e);
    const payload = normalizeAiError(e, GEMINI_CHAT_MODEL);
    return res.status(500).json(payload);
  }
});

app.post('/ai/image', auth, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: 'INVALID_PROMPT', message: 'Prompt requerido' });
    }

    let parts = [];

    if (GEMINI_API_KEY) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            responseModalities: ['TEXT', 'IMAGE']
          }
        })
      });
      const j = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: 'AI_IMAGE_ERROR', message: j?.error?.message || `Gemini API HTTP ${r.status}`, model: GEMINI_IMAGE_MODEL });
      }
      parts = j?.candidates?.[0]?.content?.parts || [];
    } else {
      const vertexAI = new VertexAI({ project: VERTEX_PROJECT, location: VERTEX_LOCATION });
      const model = vertexAI.getGenerativeModel({ model: GEMINI_IMAGE_MODEL });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          responseModalities: ['TEXT', 'IMAGE']
        }
      });
      parts = result?.response?.candidates?.[0]?.content?.parts || [];
    }
    const imagePart = parts.find(p => p.inlineData && p.inlineData.data);
    const textPart = parts.find(p => p.text);

    if (!imagePart) {
      return res.status(502).json({
        ok: false,
        error: 'NO_IMAGE_RETURNED',
        message: 'El modelo no devolvió imagen en esta respuesta.',
        model: GEMINI_IMAGE_MODEL,
        location: VERTEX_LOCATION,
        text: textPart?.text || ''
      });
    }

    return res.json({
      ok: true,
      model: GEMINI_IMAGE_MODEL,
      location: VERTEX_LOCATION,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      imageBase64: imagePart.inlineData.data,
      text: textPart?.text || ''
    });
  } catch (e) {
    console.error('[AI image]', e);
    const payload = normalizeAiError(e, GEMINI_IMAGE_MODEL);
    payload.error = 'AI_IMAGE_ERROR';
    return res.status(500).json(payload);
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
      const stage = String(req.body?.stage || '').toLowerCase();
      const mode = String(req.body?.config?.mode || 'rich').toLowerCase();
      const forceGemini = String(process.env.FORCE_GEMINI_DM || '1') === '1';

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

        // observability: always tag engine in stage=done responses
        if (stage === 'done' && payload && !payload.engine) {
          payload.engine = 'rules';
          payload.mode = mode;
        }

        return originalJson(payload);
      };

      // Gemini for free conversation after onboarding
      const isProtocolMsg = msg.startsWith('<<');
      const isBuildAckYes = /<<CONFIRM_ACK\s+TYPE="build"\s+DECISION="yes"\s*>>/i.test(msg);
      const allowGemini = forceGemini || mode === 'rich';
      const shouldUseGemini = stage === 'done' && allowGemini && (!isProtocolMsg || isBuildAckYes);
      if (shouldUseGemini) {
        try {
          const state = req.body?.clientState || {};
          const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
          const effectiveMessage = isBuildAckYes
            ? 'Acabo de completar onboarding. Dame una apertura narrativa potente y natural con opciones implícitas para continuar la historia sin pedir formato rígido.'
            : msg;

          const prompt = [
            'Eres el máster narrativo de una aventura sci-fi estilo Star Wars.',
            'Responde en español natural, corto-medio, sin etiquetas de protocolo.',
            'No uses tokens tipo <<...>> ni pidas formato rígido.',
            `Jugador: ${state?.name || 'Jugador'} | Especie: ${state?.species || 'N/D'} | Rol: ${state?.role || 'N/D'}`,
            'Contexto reciente:',
            ...history.map(h => `- ${(h?.kind || 'dm')}: ${String(h?.text || '').slice(0, 240)}`),
            `Mensaje actual del jugador: ${effectiveMessage}`
          ].join('\n');

          const out = await askGemini(prompt);
          const clean = String(out?.text || '')
            .replace(/<<[\s\S]*?>>/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .slice(0, 1200);

          if (clean) {
            return res.json({ ok: true, text: clean, engine: 'gemini', model: out.model, mode, forceGemini });
          }
        } catch (e) {
          console.error('[DM gemini fallback]', {
            message: e?.message,
            code: e?.code,
            status: e?.status,
            model: GEMINI_CHAT_MODEL,
            location: VERTEX_LOCATION
          });
        }
      }
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
