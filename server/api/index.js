// server/api/index.js
import express from 'express';
import serverless from 'serverless-http';

// ===== CORS universal (antes de cualquier router) =====
const ENV_ALLOWED = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ORIGINS = new Set([
  ...ENV_ALLOWED,
  'http://localhost:5173',
  'http://localhost:3000'
]);

const corsUniversal = (req, res, next) => {
  const origin = req.headers.origin;

  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');

  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
};

const app = express();
app.use(corsUniversal);
app.use(express.json({ limit: '1mb' }));

// Log rápido
app.use((req, _res, next) => {
  console.log('[API][IN]', req.method, req.url);
  next();
});

// Health (soporta /health y /api/health)
app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ==== Routers válidos según tu árbol de archivos ====
import authRouter from '../auth.js';
import worldRouter from '../world/index.js'; // existe
import chatRouter from '../chat.js';         // existe
import dmRouter from '../dm.js';             // existe
// 🚫 eliminado: import rollRouter from '../roll.js'

// Montaje
app.use('/auth', authRouter);
app.use('/world', worldRouter);
app.use('/chat', chatRouter);
app.use('/dm', dmRouter);
// 🚫 eliminado: app.use('/roll', rollRouter);

// 404 controlado (mantiene CORS)
app.use((req, res) => {
  console.warn('[API][404]', req.method, req.url);
  res.status(404).json({ ok: false, error: 'not_found' });
});

export default serverless(app);
