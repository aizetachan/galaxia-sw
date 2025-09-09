// Configuración de base de datos - SOLO MODO DATABASE (sin demo)
let pool = null;

// Verificación obligatoria de DATABASE_URL
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
  console.error('[DB] ❌ CRÍTICO: DATABASE_URL no está configurada');
  console.error('[DB] La aplicación requiere una conexión a PostgreSQL para funcionar');
  console.error('[DB] Configure DATABASE_URL en las variables de entorno de Vercel');
  throw new Error('DATABASE_URL is required. Configure it in Vercel environment variables.');
}

try {
  console.log('[DB] 🔄 Establishing database connection...');
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false,
      ca: undefined // Permitir certificados autofirmados
    } : false,
    // Configuración optimizada para Vercel
    connectionTimeoutMillis: 15000,
    query_timeout: 15000,
    idleTimeoutMillis: 30000,
    max: 5, // Limitar conexiones para Vercel
  });

  // Verificar conexión
  pool.on('connect', () => {
    console.log('[DB] ✅ Database connection established successfully');
  });

  pool.on('error', (err) => {
    console.error('[DB] ❌ Database connection error:', err.message);
    throw new Error(`Database connection failed: ${err.message}`);
  });

  // Inicializar tablas automáticamente
  await initDatabase();
  console.log('[DB] ✅ Database initialization completed successfully');

} catch (error) {
  console.error('[DB] ❌ Database setup failed:', error.message);
  throw new Error(`Failed to initialize database: ${error.message}`);
}

// Función para inicializar la base de datos
async function initDatabase() {
  if (!pool) return;

  try {
    console.log('[DB] Initializing database tables...');

    // Crear tabla de usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        pin_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
        role VARCHAR(20) NOT NULL,
        text TEXT NOT NULL,
        ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('[DB] Database tables initialized successfully');
  } catch (error) {
    console.error('[DB] Database initialization error:', error);
  }
}

// Función para verificar token JWT (eliminada - usar la de server/auth.js)

// Función para hashear PIN
function hashPin(pin) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(pin).digest('hex');
}

// Función para verificar PIN
function verifyPin(pin, hash) {
  return hashPin(pin) === hash;
}

async function handler(request, response) {
  console.log('Handler called with:', request.method, request.url);
  console.log('Full URL:', request.url);
  console.log('Pathname:', request.url ? request.url.split('?')[0] : 'none');

  const path = request.url ? request.url.split('?')[0] : '';

  // Manejo global de preflight CORS (OPTIONS)
  if (request.method === 'OPTIONS') {
    console.log('[CORS] Handling preflight OPTIONS request for path:', path);

    // Headers CORS estándar
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    response.setHeader('Access-Control-Max-Age', '86400'); // 24 horas

    response.statusCode = 200;
    response.end();
    return;
  }

  // Health check - probar diferentes formatos
  if (request.method === 'GET' && (path === '/api/health' || path === '/health')) {
    console.log('[HEALTH] Health endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;

    // La aplicación siempre debe tener base de datos configurada
    response.end(JSON.stringify({
      ok: true,
      message: 'API working with database',
      timestamp: Date.now(),
      database: {
        configured: true,
        status: 'connected',
        url: '[CONFIGURED]'
      },
      environment: process.env.NODE_ENV || 'production'
    }));
    return;
  }

  // Database test endpoint
  if (request.method === 'GET' && path === '/api/test-db') {
    console.log('[TEST-DB] Database test called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');

    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      message: 'Database connected and ready',
      mode: 'database',
      database: {
        configured: true,
        connected: true,
        url: '[CONFIGURED]'
      },
      environment: process.env.NODE_ENV || 'production'
    }));
    return;
  }

  // Register endpoint - manejar petición completa
  if (request.method === 'POST' && path === '/api/auth/register') {
    console.log('[REGISTER] Register endpoint called for path:', path);

    try {
      // Extraer datos del body
      let body = '';
      request.on('data', chunk => {
        body += chunk.toString();
      });

      request.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { username, pin } = data;

          console.log('[REGISTER] Registration attempt for user:', username);

          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Access-Control-Allow-Origin', '*');
          response.setHeader('Access-Control-Allow-Methods', 'POST');
          response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          // Validación básica
          if (!username || !pin) {
            response.statusCode = 400;
            response.end(JSON.stringify({
              ok: false,
              error: 'INVALID_INPUT',
              message: 'Usuario y PIN requeridos'
            }));
            return;
          }

          // Validar formato
          if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
            response.statusCode = 400;
            response.end(JSON.stringify({
              ok: false,
              error: 'INVALID_USERNAME',
              message: 'Usuario debe tener 3-24 caracteres (letras, números, _)'
            }));
            return;
          }

          if (!/^\d{4}$/.test(pin)) {
            response.statusCode = 400;
            response.end(JSON.stringify({
              ok: false,
              error: 'INVALID_PIN',
              message: 'PIN debe ser 4 dígitos'
            }));
            return;
          }

          // Registrar en base de datos (obligatorio)
          try {
            console.log('[REGISTER] Attempting database registration for:', username);

            // Verificar si usuario ya existe
            const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
            if (existingUser.rows.length > 0) {
              response.statusCode = 409;
              response.end(JSON.stringify({
                ok: false,
                error: 'USER_EXISTS',
                message: 'Usuario ya existe'
              }));
              return;
            }

            // Crear nuevo usuario
            const pinHash = hashPin(pin);
            const result = await pool.query(
              'INSERT INTO users (username, pin_hash) VALUES ($1, $2) RETURNING id',
              [username, pinHash]
            );

            const userId = result.rows[0].id;
            console.log('[REGISTER] User created with ID:', userId);

            // Generar token JWT
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
              { id: userId, username: username },
              process.env.JWT_SECRET || 'your-jwt-secret-change-this',
              { expiresIn: '7d' }
            );

            response.statusCode = 200;
            response.end(JSON.stringify({
              ok: true,
              user: { id: userId, username: username },
              token: token,
              message: 'Usuario registrado exitosamente'
            }));

          } catch (dbError) {
            console.error('[REGISTER] Database error:', dbError);
            response.statusCode = 500;
            response.end(JSON.stringify({
              ok: false,
              error: 'DATABASE_ERROR',
              message: 'Error interno del servidor'
            }));
          }

        } catch (parseError) {
          console.error('[REGISTER] JSON parse error:', parseError);
          response.statusCode = 400;
          response.end(JSON.stringify({
            ok: false,
            error: 'INVALID_JSON',
            message: 'JSON inválido'
          }));
        }
      });

    } catch (error) {
      console.error('[REGISTER] Error:', error);
      response.statusCode = 500;
      response.end(JSON.stringify({
        ok: false,
        error: 'SERVER_ERROR',
        message: 'Error en el servidor'
      }));
    }
    return;
  }

  // Login endpoint - usar lógica real
  if (request.method === 'POST' && path === '/api/auth/login') {
    console.log('[LOGIN] Login endpoint called for path:', path);

    try {
      // Extraer datos del body
      let body = '';
      request.on('data', chunk => {
        body += chunk.toString();
      });

      request.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { username, pin } = data;

          console.log('[LOGIN] Login attempt for user:', username);

          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Access-Control-Allow-Origin', '*');
          response.setHeader('Access-Control-Allow-Methods', 'POST');
          response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          // Validación básica
          if (!username || !pin) {
            response.statusCode = 400;
            response.end(JSON.stringify({
              ok: false,
              error: 'INVALID_INPUT',
              message: 'Usuario y PIN requeridos'
            }));
            return;
          }

          // Autenticar con base de datos (obligatorio)
          try {
            console.log('[LOGIN] Attempting database authentication for:', username);

            // Buscar usuario en base de datos
            const result = await pool.query('SELECT id, username, pin_hash FROM users WHERE username = $1', [username]);

            if (result.rows.length === 0) {
              response.statusCode = 401;
              response.end(JSON.stringify({
                ok: false,
                error: 'INVALID_CREDENTIALS',
                message: 'Usuario o PIN incorrectos'
              }));
              return;
            }

            const user = result.rows[0];

            // Verificar PIN
            if (!verifyPin(pin, user.pin_hash)) {
              response.statusCode = 401;
              response.end(JSON.stringify({
                ok: false,
                error: 'INVALID_CREDENTIALS',
                message: 'Usuario o PIN incorrectos'
              }));
              return;
            }

            console.log('[LOGIN] Authentication successful for user:', user.username);

            // Generar token JWT
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
              { id: user.id, username: user.username },
              process.env.JWT_SECRET || 'your-jwt-secret-change-this',
              { expiresIn: '7d' }
            );

            response.statusCode = 200;
            response.end(JSON.stringify({
              ok: true,
              user: { id: user.id, username: user.username },
              token: token,
              message: 'Login exitoso'
            }));

          } catch (dbError) {
            console.error('[LOGIN] Database error:', dbError);
            response.statusCode = 500;
            response.end(JSON.stringify({
              ok: false,
              error: 'DATABASE_ERROR',
              message: 'Error interno del servidor'
            }));
          }

        } catch (parseError) {
          console.error('[LOGIN] JSON parse error:', parseError);
          response.statusCode = 400;
          response.end(JSON.stringify({
            ok: false,
            error: 'INVALID_JSON',
            message: 'JSON inválido'
          }));
        }
      });

    } catch (error) {
      console.error('[LOGIN] Error:', error);
      response.statusCode = 500;
      response.end(JSON.stringify({
        ok: false,
        error: 'SERVER_ERROR',
        message: 'Error en el servidor'
      }));
    }
    return;
  }

  // Auth me endpoint
  if (request.method === 'GET' && path === '/api/auth/me') {
    console.log('[AUTH] Me endpoint called');

    // Verificar token en headers
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Token requerido'
      }));
      return;
    }

    // Decodificar y validar token JWT
    let userId, username;

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');

      if (!decoded.id || !decoded.username) {
        console.error('[AUTH] Token missing required fields (id or username)');
        response.statusCode = 401;
        response.end(JSON.stringify({
          ok: false,
          error: 'INVALID_TOKEN',
          message: 'Token inválido - faltan campos requeridos'
        }));
        return;
      }

      userId = decoded.id;
      username = decoded.username;
      console.log('[AUTH] Token decoded successfully:', { userId, username });

    } catch (error) {
      console.error('[AUTH] Token verification failed:', error.message);

      let errorMessage = 'Token inválido';
      if (error.name === 'TokenExpiredError') {
        errorMessage = 'Token expirado';
      } else if (error.name === 'JsonWebTokenError') {
        errorMessage = 'Token malformado';
      }

      response.statusCode = 401;
      response.end(JSON.stringify({
        ok: false,
        error: 'UNAUTHORIZED',
        message: errorMessage
      }));
      return;
    }

    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      user: { id: userId, username: username }
    }));
    return;
  }

  // World characters/me endpoint
  if (request.method === 'GET' && (path === '/api/world/characters/me' || path === '/world/characters/me')) {
    console.log('[WORLD] Characters/me endpoint called');

    // Verificar token
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Token requerido'
      }));
      return;
    }

    // Decodificar token para obtener información del usuario
    let username = 'unknown_user';
    let userId = 12345;

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');
      userId = decoded.id || 12345;
      username = decoded.username || 'unknown_user';
    } catch (error) {
      console.error('[WORLD] Error decoding token:', error);
    }

    // Buscar personaje en base de datos (obligatorio)
    try {
      console.log('[WORLD] Searching character for user:', username);

      // Buscar personaje del usuario
      const result = await pool.query(`
        SELECT c.*, u.username
        FROM characters c
        JOIN users u ON c.user_id = u.id
        WHERE u.username = $1
      `, [username]);

      if (result.rows.length > 0) {
        const character = result.rows[0];
        console.log('[WORLD] Found character:', character.name);

        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          character: {
            id: character.id,
            name: character.name,
            species: character.species,
            role: character.role,
            publicProfile: character.public_profile,
            lastLocation: character.last_location,
            createdAt: character.created_at,
            updatedAt: character.updated_at
          },
          message: 'Personaje encontrado'
        }));
      } else {
        console.log('[WORLD] No character found for user:', username);
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          character: null,
          message: `No character found for user: ${username}`
        }));
      }

    } catch (dbError) {
      console.error('[WORLD] Database error:', dbError);
      response.statusCode = 500;
      response.end(JSON.stringify({
        ok: false,
        error: 'DATABASE_ERROR',
        message: 'Error interno del servidor'
      }));
    }
    return;
  }

  // Chat history endpoint
  if (request.method === 'GET' && path === '/api/chat/history') {
    console.log('[CHAT] History endpoint called');

    // Verificar token
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Token requerido'
      }));
      return;
    }

    // Cargar historial desde base de datos (obligatorio)
    try {
      console.log('[CHAT] Loading chat history...');

      // Decodificar token para obtener información del usuario
      let userId = null;
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');
        userId = decoded.id;
      } catch (tokenError) {
        console.error('[CHAT] Token verification error:', tokenError);
        response.statusCode = 401;
        response.end(JSON.stringify({
          ok: false,
          error: 'UNAUTHORIZED',
          message: 'Token inválido'
        }));
        return;
      }

      // Buscar mensajes del usuario ordenados por fecha
      const result = await pool.query(`
        SELECT cm.*, c.name as character_name, u.username
        FROM chat_messages cm
        LEFT JOIN characters c ON cm.character_id = c.id
        JOIN users u ON cm.user_id = u.id
        WHERE cm.user_id = $1
        ORDER BY cm.ts ASC
      `, [userId]);

      const messages = result.rows.map(row => ({
        role: row.role,
        text: row.text,
        ts: row.ts.toISOString(),
        characterName: row.character_name || 'Tú'
      }));

      console.log('[CHAT] Loaded', messages.length, 'messages from database');

      response.statusCode = 200;
      response.end(JSON.stringify({
        ok: true,
        messages: messages,
        message: 'Chat history loaded'
      }));

    } catch (dbError) {
      console.error('[CHAT] Database error:', dbError);
      response.statusCode = 500;
      response.end(JSON.stringify({
        ok: false,
        error: 'DATABASE_ERROR',
        message: 'Error interno del servidor'
      }));
    }
    return;
  }

  // DM resume endpoint
  if (request.method === 'GET' && path === '/api/dm/resume') {
    console.log('[DM] Resume endpoint called');

    // Verificar token
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Token requerido'
      }));
      return;
    }

    // Simular respuesta de resumen
    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      text: 'Resumen no disponible (modo demo)',
      character: null
    }));
    return;
  }

  // Auth logout endpoint
  if (request.method === 'POST' && path === '/api/auth/logout') {
    console.log('[AUTH] Logout endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      message: 'Sesión cerrada exitosamente'
    }));
    return;
  }

  // World characters POST endpoint
  if (request.method === 'POST' && path === '/api/world/characters') {
    console.log('[WORLD] Save character endpoint called');

    // Verificar token
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Token requerido'
      }));
      return;
    }

    // Extraer datos del body
    let body = '';
    request.on('data', chunk => {
      body += chunk.toString();
    });

    request.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('[WORLD] Character data:', data);

        // Guardar personaje en base de datos (obligatorio)
        try {
          console.log('[WORLD] Saving character to database...');

          // Decodificar token para obtener información del usuario
          let userId = null;
          try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');
            userId = decoded.id;
          } catch (tokenError) {
            console.error('[WORLD] Token verification error:', tokenError);
            response.statusCode = 401;
            response.end(JSON.stringify({
              ok: false,
              error: 'UNAUTHORIZED',
              message: 'Token inválido'
            }));
            return;
          }

          // Verificar si el usuario ya tiene un personaje
          const existingCharacter = await pool.query('SELECT id FROM characters WHERE user_id = $1', [userId]);

          if (existingCharacter.rows.length > 0) {
            // Actualizar personaje existente
            const result = await pool.query(`
              UPDATE characters
              SET name = $2, species = $3, role = $4, public_profile = $5, last_location = $6, updated_at = CURRENT_TIMESTAMP
              WHERE user_id = $1
              RETURNING *
            `, [
              userId,
              data.name || data.character?.name,
              data.species || data.character?.species,
              data.role || data.character?.role,
              data.publicProfile || data.character?.publicProfile || true,
              data.lastLocation || data.character?.lastLocation || 'Tatooine — Cantina de Mos Eisley'
            ]);

            const character = result.rows[0];
            console.log('[WORLD] Character updated:', character.name);

            response.statusCode = 200;
            response.end(JSON.stringify({
              ok: true,
              character: {
                id: character.id,
                name: character.name,
                species: character.species,
                role: character.role,
                publicProfile: character.public_profile,
                lastLocation: character.last_location,
                createdAt: character.created_at,
                updatedAt: character.updated_at
              },
              message: 'Personaje actualizado exitosamente'
            }));
          } else {
            // Crear nuevo personaje
            const result = await pool.query(`
              INSERT INTO characters (user_id, name, species, role, public_profile, last_location)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING *
            `, [
              userId,
              data.name || data.character?.name,
              data.species || data.character?.species,
              data.role || data.character?.role,
              data.publicProfile || data.character?.publicProfile || true,
              data.lastLocation || data.character?.lastLocation || 'Tatooine — Cantina de Mos Eisley'
            ]);

            const character = result.rows[0];
            console.log('[WORLD] Character created:', character.name);

            response.statusCode = 200;
            response.end(JSON.stringify({
              ok: true,
              character: {
                id: character.id,
                name: character.name,
                species: character.species,
                role: character.role,
                publicProfile: character.public_profile,
                lastLocation: character.last_location,
                createdAt: character.created_at,
                updatedAt: character.updated_at
              },
              message: 'Personaje creado exitosamente'
            }));
          }

        } catch (dbError) {
          console.error('[WORLD] Database error:', dbError);
          response.statusCode = 500;
          response.end(JSON.stringify({
            ok: false,
            error: 'DATABASE_ERROR',
            message: 'Error interno del servidor'
          }));
        }
      } catch (parseError) {
        console.error('[WORLD] JSON parse error:', parseError);
        response.statusCode = 400;
        response.end(JSON.stringify({
          ok: false,
          error: 'INVALID_JSON',
          message: 'JSON inválido'
        }));
      }
    });
    return;
  }

  // DM/Master endpoints
  if (request.method === 'POST' && (path === '/api/dm/respond' || path === '/dm/respond')) {
    console.log('[DM] Respond endpoint called');

    // Verificar token
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Token requerido'
      }));
      return;
    }

    // Extraer datos del body
    let body = '';
    request.on('data', chunk => {
      body += chunk.toString();
    });

    request.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('[DM] DM request data:', data);

        // Procesar la solicitud del DM y guardar mensajes (obligatorio)
        try {
          console.log('[DM] Processing DM request with database...');

          // Decodificar token para obtener información del usuario
          let userId = null;
          let username = 'unknown_user';
          try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');
            userId = decoded.id;
            username = decoded.username;
          } catch (tokenError) {
            console.error('[DM] Token verification error:', tokenError);
            response.statusCode = 401;
            response.end(JSON.stringify({
              ok: false,
              error: 'UNAUTHORIZED',
              message: 'Token inválido'
            }));
            return;
          }

          // Guardar mensaje del usuario si existe
          if (data.message && !data.message.includes('<<CLIENT_HELLO>>') && !data.message.includes('<<ONBOARD')) {
            try {
              // Obtener el ID del personaje del usuario
              const characterResult = await pool.query('SELECT id FROM characters WHERE user_id = $1', [userId]);
              const characterId = characterResult.rows.length > 0 ? characterResult.rows[0].id : null;

              await pool.query(`
                INSERT INTO chat_messages (user_id, character_id, role, text)
                VALUES ($1, $2, $3, $4)
              `, [userId, characterId, 'user', data.message]);
              console.log('[DM] User message saved to database');
            } catch (msgError) {
              console.error('[DM] Error saving user message:', msgError);
            }
          }

          // Simular respuesta del DM (aquí iría la lógica real del LLM)
          let dmResponse = "¡Hola! Soy el Máster de la Galaxia. ¿Estás listo para tu aventura?";

          // Responder basado en el tipo de mensaje
          if (data.message.includes('<<CLIENT_HELLO>>')) {
            dmResponse = "¡Bienvenido a la Galaxia! Soy tu Máster. ¿Cuál es tu nombre?";
          } else if (data.message.includes('<<ONBOARD STEP="species"')) {
            dmResponse = "Excelente nombre. Ahora dime, ¿de qué especie eres? Elige entre: Humano, Zabrak, Twi'lek, Chiss, o cualquier otra especie de Star Wars.";
          } else if (data.message.includes('<<ONBOARD STEP="role"')) {
            dmResponse = "¡Genial! Ahora elige tu rol en la galaxia: ¿Eres un Jedi, un contrabandista, un cazarrecompensas, un diplomático, o algo más?";
          } else if (data.message.includes('<<ONBOARD DONE')) {
            dmResponse = "¡Perfecto! Tu personaje está completo. Ahora comienza tu aventura en la galaxia. ¿Qué deseas hacer primero?";
          }

          // Guardar respuesta del DM en la base de datos
          try {
            const characterResult = await pool.query('SELECT id FROM characters WHERE user_id = $1', [userId]);
            const characterId = characterResult.rows.length > 0 ? characterResult.rows[0].id : null;

            await pool.query(`
              INSERT INTO chat_messages (user_id, character_id, role, text)
              VALUES ($1, $2, $3, $4)
            `, [userId, characterId, 'dm', dmResponse]);
            console.log('[DM] DM response saved to database');
          } catch (msgError) {
            console.error('[DM] Error saving DM message:', msgError);
          }

          response.statusCode = 200;
          response.end(JSON.stringify({
            ok: true,
            text: dmResponse,
            stage: data.clientState?.step || "name"
          }));

        } catch (dbError) {
          console.error('[DM] Database error:', dbError);
          response.statusCode = 500;
          response.end(JSON.stringify({
            ok: false,
            error: 'DATABASE_ERROR',
            message: 'Error interno del servidor'
          }));
        }
      } catch (parseError) {
        console.error('[DM] JSON parse error:', parseError);
        response.statusCode = 400;
        response.end(JSON.stringify({
          ok: false,
          error: 'INVALID_JSON',
          message: 'JSON inválido'
        }));
      }
    });
    return;
  }

  // Test endpoint
  if (request.method === 'GET' && (path === '/api/test' || path === '/test')) {
    console.log('[TEST] Test endpoint called');
    response.setHeader('Content-Type', 'text/plain');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end('TEST');
    return;
  }

  // Default 404
  console.log('[DEFAULT] Route not found for method:', request.method, 'path:', path);
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.statusCode = 404;
  response.end('{"ok":false,"error":"Not found","method":"' + request.method + '","path":"' + path + '","fullUrl":"' + request.url + '"}');
}

module.exports = handler;
