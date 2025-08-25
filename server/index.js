// server/index.js
import express from 'express';
import cors from 'cors';
import { pool, q } from './db.js';
import worldRouter from './world.js';
import authRouter from './auth.js';

const app = express();

// ---------- CORS ----------
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // llamadas server-to-server o curl
    if (!origin) return cb(null, true);
    // si no has definido allowed, permite todo (útil en dev)
    if (allowed.length === 0) return cb(null, true);

    try {
      const host = new URL(origin).hostname;
      const ok =
        allowed.includes(origin) ||
        allowed.includes(host) ||
        // permite previews de vercel si añades "*.vercel.app" en ALLOWED_ORIGINS
        allowed.some(d => host === d || host.endsWith(d.replace(/^\*\./, '')));
      return ok ? cb(null, true) : cb(new Error('Not allowed by CORS'));
    } catch {
      return cb(new Error('Bad Origin'));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ---------- Body parsing ----------
app.use(express.json({ limit: '1mb' }));

// ---------- Root & Health (mantener) ----------
app.get('/', (_req, res) => {
  res.type('text/plain').send('OK: API running. Prueba /health');
});

app.get('/health', async (_req, res) => {
  const ts = new Date().toISOString();
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    return res.json({ ok: true, ts, db: { ok: true, latencyMs: Date.now() - t0 } });
  } catch (e) {
    return res.status(500).json({ ok: false, ts, db: { ok: false, error: e.message } });
  }
});

// ---------- Debug schema (solo dev) ----------
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug/schema', async (_req, res) => {
    const { rows } = await q(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY table_name, ordinal_position
    `);
    res.json({ ok: true, rows });
  });
}

// ---------- Routers ----------
app.use('/auth', authRouter);
app.use('/', worldRouter);

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API on :${PORT}`);
});
