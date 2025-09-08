// Autenticación completa con base de datos
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const router = express.Router();

// Configuración de la base de datos
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('[AUTH] Database connected for auth');
  } catch (error) {
    console.error('[AUTH] Database connection error:', error.message);
  }
}

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-this';

// Función para crear tablas si no existen
async function initDatabase() {
  if (!pool) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        pin_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[AUTH] Database initialized');
  } catch (error) {
    console.error('[AUTH] Database init error:', error.message);
  }
}

// Inicializar base de datos
initDatabase();

// Función para hashear PIN (simple para demo)
function hashPin(pin) {
  // En producción usar bcrypt
  return require('crypto').createHash('sha256').update(pin).digest('hex');
}

// Función para verificar PIN
function verifyPin(pin, hash) {
  return hashPin(pin) === hash;
}

// Función para generar JWT
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Middleware para verificar JWT
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token inválido' });
  }
}

// POST /auth/register
router.post('/register', async (req, res) => {
  console.log('[AUTH] Register called');

  try {
    const { username, pin } = req.body;

    // Validación básica
    if (!username || !pin) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Usuario y PIN requeridos'
      });
    }

    // Validar formato de usuario (3-24 caracteres, solo letras/números/_)
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_USERNAME',
        message: 'Usuario debe tener 3-24 caracteres (letras, números, _)'
      });
    }

    // Validar PIN (4 dígitos)
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_PIN',
        message: 'PIN debe ser 4 dígitos'
      });
    }

    if (pool) {
      // Verificar si usuario ya existe
      const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (existing.rows.length > 0) {
        return res.status(409).json({
          ok: false,
          error: 'USERNAME_TAKEN',
          message: 'Usuario ya existe'
        });
      }

      // Crear usuario
      const pinHash = hashPin(pin);
      const result = await pool.query(
        'INSERT INTO users (username, pin_hash) VALUES ($1, $2) RETURNING id, username',
        [username, pinHash]
      );

      const user = result.rows[0];
      const token = generateToken(user);

      // Configurar cookie con el token
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
      });

      console.log('[AUTH] User registered:', username);
      res.json({
        ok: true,
        user: { id: user.id, username: user.username },
        message: 'Usuario registrado exitosamente'
      });
    } else {
      // Modo demo - usuario falso
      console.log('[AUTH] Demo mode - fake registration for:', username);
      const user = { id: Math.floor(Math.random() * 10000), username };
      const token = generateToken(user);

      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({
        ok: true,
        user,
        message: 'Usuario registrado (modo demo)'
      });
    }
  } catch (error) {
    console.error('[AUTH] Register error:', error);
    res.status(500).json({
      ok: false,
      error: 'SERVER_ERROR',
      message: 'Error en el servidor'
    });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  console.log('[AUTH] Login called');

  try {
    const { username, pin } = req.body;

    // Validación básica
    if (!username || !pin) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Usuario y PIN requeridos'
      });
    }

    if (pool) {
      // Buscar usuario
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) {
        return res.status(401).json({
          ok: false,
          error: 'USER_NOT_FOUND',
          message: 'Usuario no encontrado'
        });
      }

      const user = result.rows[0];

      // Verificar PIN
      if (!verifyPin(pin, user.pin_hash)) {
        return res.status(401).json({
          ok: false,
          error: 'INVALID_PIN',
          message: 'PIN incorrecto'
        });
      }

      // Actualizar último login
      await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

      // Generar token
      const token = generateToken(user);

      // Configurar cookie
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      console.log('[AUTH] User logged in:', username);
      res.json({
        ok: true,
        user: { id: user.id, username: user.username },
        message: 'Login exitoso'
      });
    } else {
      // Modo demo
      console.log('[AUTH] Demo mode - fake login for:', username);
      const user = { id: Math.floor(Math.random() * 10000), username };
      const token = generateToken(user);

      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({
        ok: true,
        user,
        message: 'Login exitoso (modo demo)'
      });
    }
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({
      ok: false,
      error: 'SERVER_ERROR',
      message: 'Error en el servidor'
    });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  console.log('[AUTH] Logout called');

  // Limpiar cookie
  res.clearCookie('token');
  res.json({ ok: true, message: 'Sesión cerrada exitosamente' });
});

// GET /auth/me
router.get('/me', authenticateToken, (req, res) => {
  console.log('[AUTH] Me called for user:', req.user.username);

  res.json({
    ok: true,
    user: { id: req.user.id, username: req.user.username }
  });
});

module.exports = router;
