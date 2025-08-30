// server/index.js
import express from 'express';
import cors from 'cors';

import api from './api/router.js';

const app = express();

/* ====== Logging ====== */
app.use((req, _res, next) => {
  console.log('[REQ]', req.method, req.url, 'Origin=', req.headers.origin || '-', 'UA=', req.headers['user-agent'] || '-');
  next();
});

// morgan opcional
let morganMW = null;
try {
  const m = await import('morgan');
  morganMW = m.default || m;
  console.log('[BOOT] morgan loaded');
} catch (e) {
  console.warn('[BOOT] morgan not available, using fallback logger. Reason:', e?.message);
}
if (morganMW) app.use(morganMW('tiny'));

/* ====== Parsing ====== */
app.use(express.json({ limit: '1mb' }));

/* ====== CORS ====== */
const ALLOWED = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOpts = {
  origin(origin, cb) {
    // Permite same-origin (sin header Origin) y, si no hay lista, abre para dev
    if (!origin) return cb(null, true);
    if (!ALLOWED.length || ALLOWED.includes(origin)) return cb(null, true);
    console.warn('[CORS] blocked:', origin, 'Allowed=', ALLOWED);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOpts));
app.options('*', cors(corsOpts)); // preflight

/* ====== Salud (en /health) ====== */
function healthPayload() {
  return {
    ok: true,
    ts: Date.now(),
    env: process.env.NODE_ENV || 'production',
    api: { routes: 'mounted' },
  };
}
app.get('/health', (_req, res) => res.json(healthPayload()));
app.head('/health', (_req, res) => res.status(200).end());

const API_PREFIXES = ['/api', '/api/v1'];
for (const p of API_PREFIXES) app.use(p, api);

/* ====== Raíz opcional ====== */
app.get('/', (_req, res) => res.type('text/plain').send('OK'));

/* ====== 404 en /api/* ====== */
app.use(API_PREFIXES, (req, res) => {
  console.warn('[API 404]', req.method, req.originalUrl);
  return res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

/* ====== Manejador global de errores ====== */
app.use((err, req, res, _next) => {
  console.error('[API ERROR]', err?.stack || err?.message || err);
  return res.status(500).json({ error: 'internal_server_error' });
});

export default app;
