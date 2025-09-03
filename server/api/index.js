// api/index.js
import express from 'express';
import serverless from 'serverless-http';
import cors from 'cors';

// Routers del servidor (ajusta las rutas si tu árbol difiere)
import dmRouter from '../server/dm.js';
// Si tienes otros routers, impórtalos aquí:
// import authRouter from '../server/auth.js';
// import worldRouter from '../server/world.js';
// import chatRouter from '../server/chat.js';
// import rollRouter from '../server/roll.js';

const app = express();

// --- Middlewares base ---
app.use(cors({
  origin: true, // o limita con tu dominio si quieres
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Log de entrada (para ver por qué ruta entra cada request)
app.use((req, _res, next) => {
  console.log('[API][IN]', req.method, req.url);
  next();
});

// --- Healthcheck rápido (útil para comprobar despliegue) ---
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- Monta los routers ---
// ¡Este es el punto crítico! Si no montas /dm aquí, tu dm.js no se ejecuta.
app.use('/dm', dmRouter);
// app.use('/auth', authRouter);
// app.use('/world', worldRouter);
// app.use('/chat', chatRouter);
// app.use('/roll', rollRouter);

// 404 controlado (y log)
app.use((req, res) => {
  console.warn('[API][404]', req.method, req.url);
  res.status(404).json({ ok: false, error: 'not_found' });
});

// Export para Vercel serverless
export default serverless(app);
