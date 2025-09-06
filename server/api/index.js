// server/api/index.js
import express from 'express';
import serverless from 'serverless-http';
import cors from 'cors';

import authRouter from '../auth.js';
import worldRouter from '../world.js';
import chatRouter from '../chat.js';
import rollRouter from '../roll.js';
import dmRouter from '../dm.js';

// === CORS dinámico desde ENV ===
// ALLOWED_ORIGIN="https://galaxia-sw-kepe.vercel.app,https://galaxia-sw.vercel.app"
const ENV_ALLOWED = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Útiles en local
const LOCAL_ALLOWED = ['http://localhost:5173', 'http://localhost:3000'];

// Lista final
const ORIGINS = [...new Set([...ENV_ALLOWED, ...LOCAL_ALLOWED])];

const corsOptions = {
  origin(origin, cb) {
    // Permitir peticiones sin origin (curl/cron) y los orígenes listados
    if (!origin || ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With']
};

const app = express();

// CORS global + preflight
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '1mb' }));

// Log rápido
app.use((req, _res, next) => {
  console.log('[API][IN]', req.method, req.url);
  next();
});

// Health (cubrir ambas rutas según cómo llegue el path)
app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Routers
app.use('/auth', authRouter);
app.use('/world', worldRouter);
app.use('/chat', chatRouter);
app.use('/roll', rollRouter);
app.use('/dm', dmRouter);

// 404 controlado (importante para preflights)
app.use((req, res) => {
  console.warn('[API][404]', req.method, req.url);
  res.status(404).json({ ok: false, error: 'not_found' });
});

export default serverless(app);
