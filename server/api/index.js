// server/api/index.js
import express from 'express';
import serverless from 'serverless-http';
import cors from 'cors';

// ✅ IMPORTS desde /server (este archivo vive en /server/api)
import authRouter from '../auth.js';
import worldRouter from '../world.js';
import chatRouter from '../chat.js';
import rollRouter from '../roll.js';
import dmRouter from '../dm.js';

// --- Config CORS (lista blanca de orígenes permitidos) ---
const ORIGINS = [
  'https://galaxia-sw-kepe.vercel.app',   // front actual
  'https://galaxia-sw.vercel.app',        // por si tenéis front aquí también
  'http://localhost:5173',                // dev (opcional)
  'http://localhost:3000'                 // dev (opcional)
];

const corsOptions = {
  origin(origin, cb) {
    // Permitir sin origin (curl/cron) o si está en la whitelist
    if (!origin || ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-requested-with']
};

const app = express();

// CORS para TODAS las rutas y preflight explícito
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '1mb' }));

// Log base para ver que entra por aquí
app.use((req, _res, next) => {
  console.log('[API][IN]', req.method, req.url);
  next();
});

// Health de esta función
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 👇 Montamos TODOS los routers aquí (no dejas sueltos otros handlers)
app.use('/auth', authRouter);
app.use('/world', worldRouter);
app.use('/chat', chatRouter);
app.use('/roll', rollRouter);
app.use('/dm', dmRouter);

// 404 controlado (importante para evitar 404 en preflights)
app.use((req, res) => {
  console.warn('[API][404]', req.method, req.url);
  res.status(404).json({ ok: false, error: 'not_found' });
});

// Export para Vercel
export default serverless(app);
