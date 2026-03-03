const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const serverless = require('serverless-http');

const auth = require('../server/auth');
const dm = require('../server/dm');
const world = require('../server/world');
const chat = require('../server/chat');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

// Vercel llega como /api/...; normalizamos a /...
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) req.url = req.url.slice(4) || '/';
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    env: process.env.NODE_ENV || 'production',
    db: !!process.env.DATABASE_URL,
    dbUrl: !!process.env.DATABASE_URL
  });
});

app.use('/auth', auth);
app.use('/dm', dm);
app.use('/world', world);
app.use('/chat', chat);

app.use((err, _req, res, _next) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: err?.message || 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found', path: req.path, method: req.method });
});

module.exports = serverless(app);
