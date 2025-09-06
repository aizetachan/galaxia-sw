// server/api/index.js
import express from 'express';
import serverless from 'serverless-http';

// ===== CORS universal (refleja el Origin y contesta preflight) =====
const corsUniversal = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    // Refleja SIEMPRE el origen para que credentials funcionen
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Para llamadas sin Origin (curl/cron)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');

  if (req.method === 'OPTIONS') return res.status(204).end(); // preflight OK siempre
  next();
};

const app = express();
app.use(corsUniversal);
app.use(express.json({ limit: '1mb' }));

// Log para verificar qué llega realmente
app.use((req, _res, next) => {
  console.log('[API][IN]', req.method, req.url);
  next();
});

// Health en ambos paths
app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ==== Routers (montados con y sin prefijo /api) ====
import authRouter from '../auth.js';
import worldRouter from '../world/index.js';
import chatRouter from '../chat.js';
import dmRouter from '../dm.js';

const bases = ['', '/api'];
for (const base of bases) {
  app.use(`${base}/auth`, authRouter);
  app.use(`${base}/world`, worldRouter);
  app.use(`${base}/chat`, chatRouter);
  app.use(`${base}/dm`, dmRouter);
}

// 404 controlado (mantiene CORS)
app.use((req, res) => {
  console.warn('[API][404]', req.method, req.url);
  res.status(404).json({ ok: false, error: 'not_found' });
});

export default serverless(app);
