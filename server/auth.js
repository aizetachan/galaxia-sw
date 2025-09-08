// Autenticación con base de datos Neon
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const router = express.Router();

// Configuración de la base de datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Función para crear tablas si no existen
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        pin_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);
    console.log('[DB] Tables initialized successfully');
  } catch (error) {
    console.error('[DB] Error initializing tables:', error);
  }
}

// Inicializar base de datos al cargar el módulo
initDatabase();

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
    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'Username already exists' });
    }

    // Hash del PIN
    const pinHash = await bcrypt.hash(pin, 10);

    // Crear usuario
    const result = await pool.query(
      'INSERT INTO users (username, pin_hash) VALUES ($1, $2) RETURNING id, username',
      [username, pinHash]
    );

    const user = result.rows[0];

    // Generar token
    const token = generateToken(user);

    // Crear sesión
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    // Configurar cookie HttpOnly
    res.cookie('sid', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
    });

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
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verificar PIN
    const isValidPin = await bcrypt.compare(pin, user.pin_hash);
    if (!isValidPin) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    // Generar token
    const token = generateToken(user);

    // Crear sesión
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    // Configurar cookie HttpOnly
    res.cookie('sid', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

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
    // Eliminar sesión
    await pool.query('DELETE FROM sessions WHERE token = $1', [req.cookies.sid]);

    // Limpiar cookie
    res.clearCookie('sid');

    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[AUTH] Logout error:', error);
    res.status(500).json({ ok: false, error: 'Logout failed' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.user.userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    res.json({
      ok: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('[AUTH] Me error:', error);
    res.status(500).json({ ok: false, error: 'Failed to get user info' });
  }
});

module.exports = router;
