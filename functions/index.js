const functions = require('firebase-functions/v1');
const { logger } = functions;
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY_SECRET = defineSecret('GEMINI_API_KEY');

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || GEMINI_API_KEY_SECRET.value() || '';
}


admin.initializeApp();
const db = admin.firestore();

const dmRouter = require('./dm');
const { createDmConversationMemory } = require('./lib/dm-memory');
const { createDmGeminiMiddleware } = require('./middleware/dm-gemini');

const { updateConversationMemory, saveLastDmReply } = createDmConversationMemory();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-jwt-secret';
const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'galaxian-dae59';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-pro-preview';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
const FORCE_GEMINI_DM = String(process.env.FORCE_GEMINI_DM || '1') === '1';

function readGuidance(fileName) {
  try {
    const p = path.join(__dirname, 'guidance', fileName);
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

const GUIDANCE_MASTER = readGuidance('master-prompt.md');
const GUIDANCE_DICE = readGuidance('dice-rules.md');
const GUIDANCE_GAME = readGuidance('game-rules.md');

function stripMetaContractSection(md = '') {
  // Remove strict structure blocks to keep user-facing conversation natural
  return String(md || '')
    .replace(/##\s*Contrato de META[\s\S]*?---\s*/i, '')
    .replace(/##\s*Cómo pedir tirada[\s\S]*?---\s*/i, '')
    .replace(/##\s*Estructura de turno[\s\S]*?---\s*/i, '')
    .replace(/##\s*Opciones\s*\(options\)[\s\S]*?---\s*/i, '')
    .trim();
}

const GUIDANCE_MASTER_NATURAL = stripMetaContractSection(GUIDANCE_MASTER);
const GUIDANCE_DICE_NATURAL = stripMetaContractSection(GUIDANCE_DICE);


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

async function withTimeout(promise, ms = 12000, label = 'timeout') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function askGemini(prompt) {
  const p = String(prompt || 'Hola');
  const apiKey = getGeminiApiKey();

  // Preferred override: API key path (Google AI API)
  if (apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_CHAT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: p }] }],
        generationConfig: {
          temperature: 0.6,
          topP: 0.9,
          maxOutputTokens: 768
        }
      })
    });
    let j = null;
    let raw = '';
    try {
      j = await r.json();
    } catch {
      raw = await r.text().catch(() => '');
    }
    if (!r.ok) {
      throw new Error(j?.error?.message || raw || `Gemini API HTTP ${r.status}`);
    }
    const candidate = j?.candidates?.[0] || null;
    const finishReason = candidate?.finishReason || null;
    const text = candidate?.content?.parts?.map(x => x?.text || '').join(' ').trim() || raw || '';
    return { text, model: GEMINI_CHAT_MODEL, transport: 'api_key', finishReason };
  }

  // Fallback: Vertex path
  const vertexAI = new VertexAI({ project: VERTEX_PROJECT, location: VERTEX_LOCATION });
  const model = vertexAI.getGenerativeModel({ model: GEMINI_CHAT_MODEL });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: p }] }],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      maxOutputTokens: 768
    }
  });

  const candidate = result?.response?.candidates?.[0] || null;
  const finishReason = candidate?.finishReason || null;
  const text = candidate?.content?.parts?.map(part => part.text || '').join(' ').trim() || '';
  return { text, model: GEMINI_CHAT_MODEL, transport: 'vertex', finishReason };
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
  const apiKey = getGeminiApiKey();
  return res.json({
    ok: true,
    project: VERTEX_PROJECT,
    location: VERTEX_LOCATION,
    chatModel: GEMINI_CHAT_MODEL,
    imageModel: GEMINI_IMAGE_MODEL,
    transport: apiKey ? 'api_key' : 'vertex',
    guidance: {
      master: !!GUIDANCE_MASTER,
      dice: !!GUIDANCE_DICE,
      game: !!GUIDANCE_GAME
    }
  });
});

app.post('/ai/test', auth, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || 'Di hola en una línea.');
    const out = await withTimeout(askGemini(prompt), 15000, 'gemini_timeout');
    return res.json({ ok: true, model: out.model, location: VERTEX_LOCATION, text: out.text });
  } catch (e) {
    logger.error('[AI test]', e);
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
    const apiKey = getGeminiApiKey();

    if (apiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
    let imagePart = parts.find(p => p.inlineData && p.inlineData.data);
    let textPart = parts.find(p => p.text);

    // Retry once with stricter instruction when model returns text-only
    if (!imagePart) {
      const retryPrompt = `${prompt}\n\nIMPORTANTE: Devuelve una imagen (inline image data), no solo texto.`;
      if (apiKey) {
        const retryUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const rr = await fetch(retryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: retryPrompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
              responseModalities: ['TEXT', 'IMAGE']
            }
          })
        });
        const rj = await rr.json().catch(() => ({}));
        const rparts = rj?.candidates?.[0]?.content?.parts || [];
        imagePart = rparts.find(p => p.inlineData && p.inlineData.data) || null;
        textPart = rparts.find(p => p.text) || textPart;
      }
    }

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
    logger.error('[AI image]', e);
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
    logger.error('[AUTH register]', e);
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
    logger.error('[AUTH login]', e);
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
    logger.error('[WORLD me]', e);
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
    logger.error('[WORLD save]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Error del servidor' });
  }
});

app.get('/chat/history', auth, async (req, res) => {
  try {
    const q = await db.collection('users').doc(req.user.id).collection('messages').orderBy('ts', 'asc').limit(300).get();
    const messages = q.docs.map(d => d.data());
    return res.json({ ok: true, messages });
  } catch (e) {
    logger.error('[CHAT history]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Error del servidor' });
  }
});

app.get('/dm/resume', auth, (_req, res) => {
  return res.json({ ok: true, text: 'Resumen no implementado en v1 firebase.' });
});

app.post('/roll', auth, async (req, res) => {
  try {
    const skill = String(req.body?.skill || 'Acción');
    const roll = Math.floor(Math.random() * 20) + 1;
    const outcome = roll >= 16 ? 'success' : roll >= 10 ? 'partial' : 'fail';
    return res.json({ ok: true, skill, roll, outcome, text: `Tirada ${skill}: ${roll} (${outcome})` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'ROLL_ERROR', message: e?.message || 'Error en tirada' });
  }
});

// Persist minimal chat transcript around DM responses
}, dmRouter);

const dmMiddleware = createDmGeminiMiddleware({
  db,
  logger,
  askGemini,
  withTimeout,
  updateConversationMemory,
  saveLastDmReply,
  guidance: {
    masterNatural: GUIDANCE_MASTER_NATURAL,
    diceNatural: GUIDANCE_DICE_NATURAL,
    game: GUIDANCE_GAME
  },
  config: {
    forceGeminiDefault: FORCE_GEMINI_DM,
    geminiChatModel: GEMINI_CHAT_MODEL,
    vertexLocation: VERTEX_LOCATION
  }
});

app.use('/dm', auth, dmMiddleware, dmRouter);

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found', path: req.path, method: req.method }));

exports.api = functions
  .region('europe-west1')
  .runWith({
    serviceAccount: 'galaxian-dae59@appspot.gserviceaccount.com',
    secrets: [GEMINI_API_KEY_SECRET]
  })
  .https.onRequest(app);
