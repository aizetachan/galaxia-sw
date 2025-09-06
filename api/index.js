// Adaptador Vercel para Express - Versión mínima
import serverless from 'serverless-http';

// Crear una app Express mínima para evitar timeouts
import express from 'express';
import cookieParser from 'cookie-parser';

const app = express();

// Middleware básico
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Health check simple
app.get('/api/health', (req, res) => {
  console.log('[HEALTH] Health check requested');
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Auth endpoints básicos
app.post('/api/auth/register', async (req, res) => {
  console.log('[AUTH/register] Request received');
  console.log('[AUTH/register] Headers:', req.headers);
  console.log('[AUTH/register] Body:', req.body);
  
  try {
    const { username, pin } = req.body;
    
    if (!username || !pin) {
      console.log('[AUTH/register] Missing username or pin');
      return res.status(400).json({ ok: false, error: 'Username and pin required' });
    }
    
    console.log('[AUTH/register] Creating user:', username);
    
    // Simular creación de usuario (sin DB por ahora)
    const user = {
      id: Date.now().toString(),
      username,
      pin,
      created_at: new Date().toISOString()
    };
    
    console.log('[AUTH/register] User created:', user);
    
    // Establecer cookie de autenticación
    res.cookie('auth_token', 'dummy_token_' + user.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000 // 24 horas
    });
    
    console.log('[AUTH/register] Cookie set, sending response');
    res.json({ ok: true, user });
    
  } catch (error) {
    console.error('[AUTH/register] Error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  console.log('[AUTH/login] Request received');
  console.log('[AUTH/login] Headers:', req.headers);
  console.log('[AUTH/login] Body:', req.body);
  
  try {
    const { username, pin } = req.body;
    
    if (!username || !pin) {
      console.log('[AUTH/login] Missing username or pin');
      return res.status(400).json({ ok: false, error: 'Username and pin required' });
    }
    
    console.log('[AUTH/login] Authenticating user:', username);
    
    // Simular autenticación (sin DB por ahora)
    const user = {
      id: Date.now().toString(),
      username,
      pin,
      created_at: new Date().toISOString()
    };
    
    console.log('[AUTH/login] User authenticated:', user);
    
    // Establecer cookie de autenticación
    res.cookie('auth_token', 'dummy_token_' + user.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000 // 24 horas
    });
    
    console.log('[AUTH/login] Cookie set, sending response');
    res.json({ ok: true, user });
    
  } catch (error) {
    console.error('[AUTH/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// Middleware de autenticación
app.use('/api', (req, res, next) => {
  console.log('[AUTH] Checking authentication for:', req.method, req.url);
  const token = req.cookies?.auth_token;
  
  if (!token) {
    console.log('[AUTH] No token found');
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }
  
  console.log('[AUTH] Token found:', token);
  next();
});

// Endpoints protegidos básicos
app.get('/api/user', (req, res) => {
  console.log('[API/user] User info requested');
  res.json({ ok: true, user: { id: '1', username: 'test' } });
});

// Catch-all para rutas no encontradas
app.use('*', (req, res) => {
  console.log('[API] Route not found:', req.method, req.originalUrl);
  res.status(404).json({ ok: false, error: 'Route not found' });
});

export default serverless(app);
