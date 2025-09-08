// Mundo vivo con base de datos
const express = require('express');
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
    console.log('[WORLD] Database connected for world');
  } catch (error) {
    console.error('[WORLD] Database connection error:', error.message);
  }
}

// Función para inicializar tablas
async function initWorldDatabase() {
  if (!pool) return;

  try {
    // Crear tabla de personajes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS characters (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        species VARCHAR(50),
        role VARCHAR(50),
        public_profile BOOLEAN DEFAULT true,
        last_location TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);

    // Crear tabla de mensajes del chat
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL, -- 'user' o 'dm'
        text TEXT NOT NULL,
        ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('[WORLD] World database initialized');
  } catch (error) {
    console.error('[WORLD] Database init error:', error.message);
  }
}

// Inicializar base de datos
initWorldDatabase();

// Middleware para verificar autenticación
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token requerido' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token inválido' });
  }
}

// GET /world/state
router.get('/state', (req, res) => {
  if (pool) {
    res.json({
      ok: true,
      message: 'World state available',
      state: {
        database: true,
        timestamp: Date.now()
      }
    });
  } else {
    res.json({
      ok: true,
      message: 'World state not available (requires database)',
      state: {}
    });
  }
});

// GET /world/characters/me
router.get('/characters/me', authenticateToken, async (req, res) => {
  try {
    if (!pool) {
      return res.json({
        ok: true,
        message: 'Characters not available (requires database)',
        character: null
      });
    }

    // Buscar personaje del usuario
    const result = await pool.query(`
      SELECT c.*, u.username
      FROM characters c
      JOIN users u ON c.user_id = u.id
      WHERE c.user_id = $1
    `, [req.user.id]);

    if (result.rows.length > 0) {
      const character = result.rows[0];
      console.log('[WORLD] Found character for user:', req.user.username, character);

      res.json({
        ok: true,
        character: {
          id: character.id,
          name: character.name,
          species: character.species,
          role: character.role,
          publicProfile: character.public_profile,
          lastLocation: character.last_location,
          userId: character.user_id
        }
      });
    } else {
      console.log('[WORLD] No character found for user:', req.user.username);
      res.json({
        ok: true,
        character: null
      });
    }
  } catch (error) {
    console.error('[WORLD] Error fetching character:', error);
    res.status(500).json({
      ok: false,
      error: 'SERVER_ERROR',
      message: 'Error al obtener personaje'
    });
  }
});

// POST /world/characters (crear/actualizar personaje)
router.post('/characters', authenticateToken, async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        ok: false,
        error: 'DATABASE_UNAVAILABLE',
        message: 'Base de datos no disponible'
      });
    }

    const { name, species, role, publicProfile, lastLocation, character } = req.body;

    // Si se envía un objeto character completo, usar sus valores
    const charName = character?.name || name;
    const charSpecies = character?.species || species;
    const charRole = character?.role || role;
    const charPublicProfile = character?.publicProfile !== undefined ? character.publicProfile : (publicProfile !== undefined ? publicProfile : true);
    const charLastLocation = character?.lastLocation || lastLocation || 'Tatooine — Cantina de Mos Eisley';

    if (!charName) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_DATA',
        message: 'Nombre del personaje requerido'
      });
    }

    // Intentar insertar o actualizar
    const result = await pool.query(`
      INSERT INTO characters (user_id, name, species, role, public_profile, last_location, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        species = EXCLUDED.species,
        role = EXCLUDED.role,
        public_profile = EXCLUDED.public_profile,
        last_location = EXCLUDED.last_location,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [req.user.id, charName, charSpecies, charRole, charPublicProfile, charLastLocation]);

    const savedCharacter = result.rows[0];
    console.log('[WORLD] Character saved for user:', req.user.username, savedCharacter);

    res.json({
      ok: true,
      character: {
        id: savedCharacter.id,
        name: savedCharacter.name,
        species: savedCharacter.species,
        role: savedCharacter.role,
        publicProfile: savedCharacter.public_profile,
        lastLocation: savedCharacter.last_location,
        userId: savedCharacter.user_id
      },
      message: 'Personaje guardado exitosamente'
    });
  } catch (error) {
    console.error('[WORLD] Error saving character:', error);
    res.status(500).json({
      ok: false,
      error: 'SERVER_ERROR',
      message: 'Error al guardar personaje'
    });
  }
});

module.exports = router;
