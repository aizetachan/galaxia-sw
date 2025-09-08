// Server principal para desarrollo local y adaptador Vercel
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const serverless = require('serverless-http');

// Importar módulos
const auth = require('./auth');
const dm = require('./dm');
const world = require('./world');
const chat = require('./chat');

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// CORS - permitir solo orígenes específicos
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',')
  : ['http://localhost:3000', 'https://galaxia-sw-kepe.vercel.app'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

// Health check
app.get('/health', (req, res) => {
  console.log('[HEALTH] Health check called');
  res.json({
    ok: true,
    ts: Date.now(),
    env: process.env.NODE_ENV || 'development',
    db: !!process.env.DATABASE_URL
  });
});

// Test endpoint simple
app.get('/test', (req, res) => {
  console.log('[TEST] Test endpoint called');
  res.json({ ok: true, message: 'Test endpoint working' });
});

// Test endpoint para verificar módulos
app.get('/test-auth', (req, res) => {
  console.log('[TEST-AUTH] Testing auth module import');
  try {
    const auth = require('./auth');
    console.log('[TEST-AUTH] Auth module imported successfully');
    res.json({ ok: true, message: 'Auth module import successful' });
  } catch (error) {
    console.error('[TEST-AUTH] Error importing auth module:', error);
    res.status(500).json({ ok: false, error: 'Auth module import failed', details: error.message });
  }
});

// Rutas de autenticación
app.use('/auth', auth);

// Rutas del máster IA
app.use('/dm', dm);

// Rutas del mundo vivo (requiere BD)
app.use('/world', world);

// Rutas de chat
app.use('/chat', chat);

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    ok: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Not found',
    path: req.path,
    method: req.method
  });
});

// Para desarrollo local
if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

// Para Vercel (exporta el handler serverless)
module.exports = serverless(app);
