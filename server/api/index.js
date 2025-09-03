// api/index.js
import express from 'express';
import serverless from 'serverless-http';
import cors from 'cors';

// ✅ IMPORT CORRECTO: index.js está en /server/api, dm.js está en /server.
// Con ../dm.js llegamos a /server/dm.js
import dmRouter from '../dm.js';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Log de entrada (útil en Vercel)
app.use((req, _res, next) => {
  console.log('[API][IN]', req.method, req.url);
  next();
});

// Health para diagnosticar este handler
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 👇 Solo montamos /dm aquí (no tocamos /auth, /world, /chat, etc.)
app.use('/dm', dmRouter);

// 404 controlado
app.use((req, res) => {
  console.warn('[API][404]', req.method, req.url);
  res.status(404).json({ ok: false, error: 'not_found' });
});

export default serverless(app);
