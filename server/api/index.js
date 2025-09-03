// api/index.js
import express from 'express';
import serverless from 'serverless-http';
import cors from 'cors';

import dmRouter from '../server/dm.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => { console.log('[API][IN]', req.method, req.url); next(); });
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 👇 MUY IMPORTANTE: aquí queda montado tu dm.js
app.use('/dm', dmRouter);

app.use((req, res) => {
  console.warn('[API][404]', req.method, req.url);
  res.status(404).json({ ok: false, error: 'not_found' });
});

export default serverless(app);
