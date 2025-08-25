// server/index.js
import express from 'express';
import cors from 'cors';
import { pool, q } from './db.js';
import worldRouter from './world.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ===== Raíz existente (NO romper)
app.get('/', (req, res) => {
  res.type('text/plain').send('OK: API running. Prueba /health');
});

// ===== Salud básica (mantiene lo que ya tenías)
app.get('/health', async (req, res) => {
  const ts = new Date().toISOString();
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    return res.json({ ok: true, ts, db: { ok: true, latencyMs: Date.now() - t0 } });
  } catch (e) {
    return res.status(500).json({ ok: false, ts, db: { ok: false, error: e.message } });
  }
});

// ===== Opcional: esquema (solo en dev)
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug/schema', async (req, res) => {
    const { rows } = await q(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY table_name, ordinal_position
    `);
    res.json({ ok: true, rows });
  });
}

// ===== RUTAS DE MUNDO / PERSONAJES / EVENTOS
app.use('/', worldRouter);

// ===== Arranque
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API on :${PORT}`);
});
