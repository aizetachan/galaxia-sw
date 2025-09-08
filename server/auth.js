// Autenticación temporal sin base de datos (para testing)
const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Almacenamiento temporal en memoria (para testing)
const users = new Map();
const sessions = new Map();

console.log('[AUTH] Using in-memory storage for testing (no database configured)');

// Función para generar JWT
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET || 'galaxia-secret-key',
    { expiresIn: '7d' }
  );
}

// Función para verificar JWT
function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'galaxia-secret-key');
  } catch (error) {
    return null;
  }
}

// Middleware de autenticación
function requireAuth(req, res, next) {
  const token = req.cookies.sid || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ ok: false, error: 'No token provided' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }

  req.user = decoded;
  next();
}

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, pin } = req.body;

    if (!username || !pin) {
      return res.status(400).json({ ok: false, error: 'Username and PIN are required' });
    }

    // Validar username
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        ok: false,
        error: 'Username must be 3-24 characters, alphanumeric + underscore'
      });
    }

    // Validar PIN
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ ok: false, error: 'PIN must be 4 digits' });
    }

    // Verificar si el usuario ya existe
    if (users.has(username)) {
      return res.status(409).json({ ok: false, error: 'Username already exists' });
    }

    // Crear usuario (PIN en texto plano para testing)
    const userId = Date.now(); // ID simple para testing
    const user = {
      id: userId,
      username,
      pin,
      createdAt: new Date()
    };

    users.set(username, user);

    // Generar token
    const token = generateToken(user);

    // Crear sesión
    const sessionId = Date.now().toString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    sessions.set(sessionId, {
      id: sessionId,
      userId: user.id,
      token,
      expiresAt
    });

    // Configurar cookie HttpOnly
    res.cookie('sid', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
    });

    console.log(`[AUTH] User registered: ${username}`);
    res.json({
      ok: true,
      user: { id: user.id, username: user.username },
      message: 'User registered successfully'
    });

  } catch (error) {
    console.error('[AUTH] Register error:', error);
    res.status(500).json({ ok: false, error: 'Registration failed' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, pin } = req.body;

    if (!username || !pin) {
      return res.status(400).json({ ok: false, error: 'Username and PIN are required' });
    }

    // Buscar usuario
    const user = users.get(username);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    // Verificar PIN (comparación simple para testing)
    if (pin !== user.pin) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    // Generar token
    const token = generateToken(user);

    // Crear sesión
    const sessionId = Date.now().toString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    sessions.set(sessionId, {
      id: sessionId,
      userId: user.id,
      token,
      expiresAt
    });

    // Configurar cookie HttpOnly
    res.cookie('sid', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    console.log(`[AUTH] User logged in: ${username}`);
    res.json({
      ok: true,
      user: { id: user.id, username: user.username },
      message: 'Login successful'
    });

  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    // Eliminar sesión (en memoria)
    const token = req.cookies.sid;
    for (const [sessionId, session] of sessions) {
      if (session.token === token) {
        sessions.delete(sessionId);
        break;
      }
    }

    // Limpiar cookie
    res.clearCookie('sid');

    console.log('[AUTH] User logged out');
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[AUTH] Logout error:', error);
    res.status(500).json({ ok: false, error: 'Logout failed' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Buscar usuario por ID
    let user = null;
    for (const [username, userData] of users) {
      if (userData.id === req.user.userId) {
        user = userData;
        break;
      }
    }

    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    res.json({
      ok: true,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error('[AUTH] Me error:', error);
    res.status(500).json({ ok: false, error: 'Failed to get user info' });
  }
});

module.exports = router;
