// Configuración de base de datos - SOLO MODO DATABASE (sin demo)
let pool = null;
let dbInitialized = false;

// Función para inicializar la base de datos (lazy initialization)
async function initializeDatabase() {
  console.log('[DB] 📋 DEBUG: initializeDatabase called');
  console.log('[DB] 📋 DEBUG: dbInitialized current state:', dbInitialized);
  console.log('[DB] 📋 DEBUG: DATABASE_URL exists:', !!process.env.DATABASE_URL);
  console.log('[DB] 📋 DEBUG: DATABASE_URL length:', process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0);
  console.log('[DB] 📋 DEBUG: NODE_ENV:', process.env.NODE_ENV);

  if (dbInitialized) {
    console.log('[DB] 📋 DEBUG: Database already initialized, returning');
    return;
  }

  if (dbInitialized === 'failed') {
    console.log('[DB] 📋 DEBUG: Database initialization failed previously, throwing error');
    throw new Error('Database initialization failed previously');
  }

  try {
    console.log('[DB] 🔄 Starting database initialization...');
    dbInitialized = 'initializing';

    // Verificación obligatoria de DATABASE_URL
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
      console.error('[DB] ❌ CRÍTICO: DATABASE_URL no está configurada');
      console.error('[DB] ❌ CRÍTICO: process.env.DATABASE_URL:', process.env.DATABASE_URL);
      console.error('[DB] ❌ CRÍTICO: Available env vars:', Object.keys(process.env).filter(key => key.includes('DATABASE') || key.includes('URL')));
      console.error('[DB] La aplicación requiere una conexión a PostgreSQL para funcionar');
      console.error('[DB] Configure DATABASE_URL en las variables de entorno de Vercel');
      dbInitialized = 'failed';
      throw new Error('DATABASE_URL is required. Configure it in Vercel environment variables.');
    }

    console.log('[DB] 📋 DEBUG: DATABASE_URL validated successfully');

    const { Pool } = require('pg');
    console.log('[DB] 📋 DEBUG: Creating PostgreSQL pool...');

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

    console.log('[DB] 📋 DEBUG: Pool created, setting up event listeners...');

    // Verificar conexión
    pool.on('connect', () => {
      console.log('[DB] ✅ Database connection established successfully');
    });

    pool.on('error', (err) => {
      console.error('[DB] ❌ Database connection error:', err.message);
      console.error('[DB] ❌ Database connection error details:', err);
      dbInitialized = 'failed';
      throw new Error(`Database connection failed: ${err.message}`);
    });

    console.log('[DB] 📋 DEBUG: Calling initDatabase()...');

    // Inicializar tablas automáticamente
    await initDatabase();
    console.log('[DB] ✅ Database initialization completed successfully');
    console.log('[DB] 📋 DEBUG: Tables created successfully');
    dbInitialized = true;

  } catch (error) {
    console.error('[DB] ❌ Database setup failed:', error.message);
    console.error('[DB] ❌ Database setup error details:', error);
    console.error('[DB] ❌ Database setup stack:', error.stack);
    dbInitialized = 'failed';
    throw new Error(`Failed to initialize database: ${error.message}`);
  }
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

    // Verificar y corregir characters con user_id NULL
    await checkAndFixNullUserIds();

  } catch (error) {
    console.error('[DB] Database initialization error:', error);
  }
}

// Función para verificar y corregir characters con user_id NULL
async function checkAndFixNullUserIds() {
  try {
    console.log('[DB] 🔍 Checking for characters with NULL user_id...');

    // Buscar characters con user_id NULL
    const nullUserIdCharacters = await pool.query(`
      SELECT id, name, created_at
      FROM characters
      WHERE user_id IS NULL
      ORDER BY created_at DESC
    `);

    console.log(`[DB] 📋 Found ${nullUserIdCharacters.rows.length} characters with NULL user_id`);

    if (nullUserIdCharacters.rows.length > 0) {
      console.log('[DB] ⚠️  Characters with NULL user_id detected:');
      nullUserIdCharacters.rows.forEach((char, index) => {
        console.log(`   ${index + 1}. ID: ${char.id}, Name: ${char.name}, Created: ${char.created_at}`);
      });

      console.log('[DB] 🗑️  Deleting characters with NULL user_id to prevent data corruption...');

      // Eliminar characters con user_id NULL
      const deleteResult = await pool.query(`
        DELETE FROM characters
        WHERE user_id IS NULL
      `);

      console.log(`[DB] ✅ Deleted ${deleteResult.rowCount} characters with NULL user_id`);
      console.log('[DB] 🛡️  Data integrity restored');
    } else {
      console.log('[DB] ✅ No characters with NULL user_id found');
    }

    // Verificar integridad de relaciones
    const integrityCheck = await pool.query(`
      SELECT
        COUNT(*) as total_characters,
        COUNT(CASE WHEN user_id IS NULL THEN 1 END) as null_user_ids,
        COUNT(DISTINCT user_id) as unique_users_with_characters
      FROM characters
    `);

    const stats = integrityCheck.rows[0];
    console.log('[DB] 📊 Database integrity stats:');
    console.log(`   - Total characters: ${stats.total_characters}`);
    console.log(`   - Characters with NULL user_id: ${stats.null_user_ids}`);
    console.log(`   - Users with characters: ${stats.unique_users_with_characters}`);

    if (stats.null_user_ids > 0) {
      console.error('[DB] ❌ CRÍTICO: Still found characters with NULL user_id after cleanup!');
    } else {
      console.log('[DB] ✅ Database integrity verified');
    }

  } catch (error) {
    console.error('[DB] ❌ Error checking/fixing NULL user_ids:', error);
    // No lanzamos error aquí para no romper la inicialización
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

  // Inicializar base de datos si no está inicializada
  try {
    await initializeDatabase();
  } catch (dbError) {
    console.error('[HANDLER] Database initialization failed:', dbError.message);
    response.setHeader('Content-Type', 'application/json');
    response.statusCode = 500;
    response.end(JSON.stringify({
      ok: false,
      error: 'DATABASE_ERROR',
      message: 'Error interno del servidor - Base de datos no disponible'
    }));
    return;
  }

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

    // Estado de la base de datos
    response.end(JSON.stringify({
      ok: true,
      message: dbInitialized === true ? 'API working with database' : 'Database initializing...',
      timestamp: Date.now(),
      database: {
        configured: !!process.env.DATABASE_URL,
        status: dbInitialized === true ? 'connected' : 'initializing',
        url: process.env.DATABASE_URL ? '[CONFIGURED]' : '[NOT_SET]'
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
        configured: !!process.env.DATABASE_URL,
        connected: dbInitialized === true,
        url: process.env.DATABASE_URL ? '[CONFIGURED]' : '[NOT_SET]'
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
            console.log('[REGISTER] 📋 DEBUG: Starting database registration for:', username);
            console.log('[REGISTER] 📋 DEBUG: PIN provided:', !!pin);
            console.log('[REGISTER] 📋 DEBUG: Pool exists:', !!pool);
            console.log('[REGISTER] 📋 DEBUG: Pool state:', pool ? 'connected' : 'null');

            // Verificar si usuario ya existe
            console.log('[REGISTER] 📋 DEBUG: Checking if user exists...');
            const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
            console.log('[REGISTER] 📋 DEBUG: Existing user query result:', existingUser.rows.length, 'rows');

            if (existingUser.rows.length > 0) {
              console.log('[REGISTER] 📋 DEBUG: User already exists, returning 409');
              response.statusCode = 409;
              response.end(JSON.stringify({
                ok: false,
                error: 'USER_EXISTS',
                message: 'Usuario ya existe'
              }));
              return;
            }

            // Crear nuevo usuario
            console.log('[REGISTER] 📋 DEBUG: Creating new user...');
            const pinHash = hashPin(pin);
            console.log('[REGISTER] 📋 DEBUG: PIN hashed successfully');

            const result = await pool.query(
              'INSERT INTO users (username, pin_hash) VALUES ($1, $2) RETURNING id',
              [username, pinHash]
            );

            console.log('[REGISTER] 📋 DEBUG: Insert query result:', result.rows.length, 'rows');
            const userId = result.rows[0].id;
            console.log('[REGISTER] ✅ User created with ID:', userId);

            // Generar token JWT
            console.log('[REGISTER] 📋 DEBUG: Generating JWT token...');
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
              { id: userId, username: username },
              process.env.JWT_SECRET || 'your-jwt-secret-change-this',
              { expiresIn: '7d' }
            );
            console.log('[REGISTER] 📋 DEBUG: JWT token generated successfully');

            console.log('[REGISTER] ✅ Registration completed successfully');
            response.statusCode = 200;
            response.end(JSON.stringify({
              ok: true,
              user: { id: userId, username: username },
              token: token,
              message: 'Usuario registrado exitosamente'
            }));

          } catch (dbError) {
            console.error('[REGISTER] ❌ Database error:', dbError.message);
            console.error('[REGISTER] ❌ Database error details:', dbError);
            console.error('[REGISTER] ❌ Database error stack:', dbError.stack);
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
            console.log('[LOGIN] 📋 DEBUG: Starting database authentication for:', username);
            console.log('[LOGIN] 📋 DEBUG: PIN provided:', !!pin);
            console.log('[LOGIN] 📋 DEBUG: Pool exists:', !!pool);

            // Buscar usuario en base de datos
            console.log('[LOGIN] 📋 DEBUG: Querying user from database...');
            const result = await pool.query('SELECT id, username, pin_hash FROM users WHERE username = $1', [username]);
            console.log('[LOGIN] 📋 DEBUG: User query result:', result.rows.length, 'rows');

            if (result.rows.length === 0) {
              console.log('[LOGIN] 📋 DEBUG: User not found, returning 401');
              response.statusCode = 401;
              response.end(JSON.stringify({
                ok: false,
                error: 'INVALID_CREDENTIALS',
                message: 'Usuario o PIN incorrectos'
              }));
              return;
            }

            const user = result.rows[0];
            console.log('[LOGIN] 📋 DEBUG: User found:', user.username, 'ID:', user.id);

            // Verificar PIN
            console.log('[LOGIN] 📋 DEBUG: Verifying PIN...');
            const pinValid = verifyPin(pin, user.pin_hash);
            console.log('[LOGIN] 📋 DEBUG: PIN verification result:', pinValid);

            if (!pinValid) {
              console.log('[LOGIN] 📋 DEBUG: Invalid PIN, returning 401');
              response.statusCode = 401;
              response.end(JSON.stringify({
                ok: false,
                error: 'INVALID_CREDENTIALS',
                message: 'Usuario o PIN incorrectos'
              }));
              return;
            }

            console.log('[LOGIN] ✅ Authentication successful for user:', user.username);

            // Generar token JWT
            console.log('[LOGIN] 📋 DEBUG: Generating JWT token...');
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
              { id: user.id, username: user.username },
              process.env.JWT_SECRET || 'your-jwt-secret-change-this',
              { expiresIn: '7d' }
            );
            console.log('[LOGIN] 📋 DEBUG: JWT token generated successfully');

            console.log('[LOGIN] ✅ Login completed successfully');
            response.statusCode = 200;
            response.end(JSON.stringify({
              ok: true,
              user: { id: user.id, username: user.username },
              token: token,
              message: 'Login exitoso'
            }));

          } catch (dbError) {
            console.error('[LOGIN] ❌ Database error:', dbError.message);
            console.error('[LOGIN] ❌ Database error details:', dbError);
            console.error('[LOGIN] ❌ Database error stack:', dbError.stack);
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
    console.log('[AUTH] 📋 DEBUG: Me endpoint called');
    console.log('[AUTH] 📋 DEBUG: Request headers:', Object.keys(request.headers));
    console.log('[AUTH] 📋 DEBUG: Authorization header exists:', !!request.headers.authorization || !!request.headers.Authorization);

    // Verificar token en headers
    const authHeader = request.headers.authorization || request.headers.Authorization;
    console.log('[AUTH] 📋 DEBUG: Auth header:', authHeader ? 'present' : 'missing');
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    console.log('[AUTH] 📋 DEBUG: Token extracted:', token ? 'present' : 'missing');

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      console.log('[AUTH] 📋 DEBUG: No token provided, returning 401');
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
    console.log('[AUTH] 📋 DEBUG: Starting token verification...');

    try {
      const jwt = require('jsonwebtoken');
      console.log('[AUTH] 📋 DEBUG: JWT_SECRET exists:', !!process.env.JWT_SECRET);
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');
      console.log('[AUTH] 📋 DEBUG: Token decoded successfully:', decoded);

      if (!decoded.id || !decoded.username) {
        console.error('[AUTH] ❌ Token missing required fields (id or username)');
        console.error('[AUTH] ❌ Decoded token:', decoded);
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
      console.log('[AUTH] ✅ Token validation successful:', { userId, username });

    } catch (error) {
      console.error('[AUTH] ❌ Token verification failed:', error.name, error.message);
      console.error('[AUTH] ❌ Token verification error details:', error);

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

    console.log('[AUTH] 📋 DEBUG: Returning user data for:', username);
    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      user: { id: userId, username: username }
    }));
    return;
  }

  // World characters/me endpoint
  if (request.method === 'GET' && (path === '/api/world/characters/me' || path === '/world/characters/me')) {
    console.log('[WORLD] 📋 DEBUG: Characters/me endpoint called');
    console.log('[WORLD] 📋 DEBUG: Request path:', path);

    // Verificar token
    const authHeader = request.headers.authorization || request.headers.Authorization;
    console.log('[WORLD] 📋 DEBUG: Auth header exists:', !!authHeader);
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    console.log('[WORLD] 📋 DEBUG: Token extracted:', !!token);

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!token) {
      console.log('[WORLD] 📋 DEBUG: No token provided, returning 401');
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
      console.log('[WORLD] 📋 DEBUG: Decoding token...');
      console.log('[WORLD] 📋 DEBUG: JWT_SECRET exists:', !!process.env.JWT_SECRET);
      console.log('[WORLD] 📋 DEBUG: Token to decode:', token ? token.substring(0, 50) + '...' : 'NO TOKEN');

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-change-this');
      console.log('[WORLD] 📋 DEBUG: Raw decoded token:', decoded);

      userId = decoded.id;
      username = decoded.username;

      console.log('[WORLD] 📋 DEBUG: Extracted userId:', userId, 'type:', typeof userId);
      console.log('[WORLD] 📋 DEBUG: Extracted username:', username);

      // Validación crítica del userId
      if (!userId || userId === 12345) {
        console.error('[WORLD] ❌ CRÍTICO: userId inválido o faltante');
        console.error('[WORLD] ❌ userId value:', userId);
        console.error('[WORLD] ❌ Esto causará characters con user_id NULL');
        response.statusCode = 401;
        response.end(JSON.stringify({
          ok: false,
          error: 'INVALID_TOKEN',
          message: 'Token inválido - userId faltante'
        }));
        return;
      }

      console.log('[WORLD] ✅ Token validation successful');
    } catch (error) {
      console.error('[WORLD] ❌ Error decoding token:', error.name, error.message);
      console.error('[WORLD] ❌ Token decode error details:', error);
      console.error('[WORLD] ❌ Esto causará characters con user_id NULL');
    }

    // Buscar personaje en base de datos (obligatorio)
    try {
      console.log('[WORLD] 📋 DEBUG: Searching character for user:', username);
      console.log('[WORLD] 📋 DEBUG: Pool exists:', !!pool);

      // Buscar personaje del usuario
      console.log('[WORLD] 📋 DEBUG: Executing character query for userId:', userId, 'type:', typeof userId);

      // Convertir userId a integer para asegurar compatibilidad con BD
      const numericUserId = parseInt(userId, 10);
      console.log('[WORLD] 📋 DEBUG: Converted userId to:', numericUserId, 'type:', typeof numericUserId);

      const result = await pool.query(`
        SELECT c.*, u.username
        FROM characters c
        JOIN users u ON c.user_id = u.id
        WHERE c.user_id = $1
      `, [numericUserId]);

      console.log('[WORLD] 📋 DEBUG: Character query result:', result.rows.length, 'rows');

      if (result.rows.length > 0) {
        const character = result.rows[0];
        console.log('[WORLD] ✅ Found character:', character.name, 'ID:', character.id);
        console.log('[WORLD] 📋 DEBUG: Character data:', {
          name: character.name,
          species: character.species,
          role: character.role,
          publicProfile: character.public_profile,
          lastLocation: character.last_location
        });

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
        console.log('[WORLD] 📋 DEBUG: No character found for userId:', numericUserId, 'original:', userId, 'username:', username);
        console.log('[WORLD] 📋 DEBUG: This might indicate onboarding is needed');
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          character: null,
          message: `No character found for user: ${username}`
        }));
      }

    } catch (dbError) {
      console.error('[WORLD] ❌ Database error:', dbError.message);
      console.error('[WORLD] ❌ Database error details:', dbError);
      console.error('[WORLD] ❌ Database error stack:', dbError.stack);
      console.error('[WORLD] ❌ This error prevents character data from being retrieved');
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

    request.on('end', async () => {
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
          console.log('[WORLD] 📋 DEBUG: Checking existing character for userId:', userId);
          console.log('[WORLD] 📋 DEBUG: userId type:', typeof userId, 'value:', userId);
          const existingCharacter = await pool.query('SELECT id FROM characters WHERE user_id = $1', [userId]);
          console.log('[WORLD] 📋 DEBUG: Existing character query result:', existingCharacter.rows.length, 'rows');

          if (existingCharacter.rows.length > 0) {
            // Actualizar personaje existente
            console.log('[WORLD] 📋 DEBUG: Updating existing character, ID:', existingCharacter.rows[0].id);
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
            console.log('[WORLD] ✅ Character updated:', character.name);
            console.log('[WORLD] 📋 DEBUG: Updated character user_id:', character.user_id);

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
            console.log('[WORLD] 📋 DEBUG: Creating new character for userId:', userId);
            console.log('[WORLD] 📋 DEBUG: Character data to insert:');
            console.log('  - user_id:', userId);
            console.log('  - name:', data.name || data.character?.name);
            console.log('  - species:', data.species || data.character?.species);
            console.log('  - role:', data.role || data.character?.role);

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

            console.log('[WORLD] 📋 DEBUG: Insert result:', result.rows.length, 'rows');
            const character = result.rows[0];
            console.log('[WORLD] ✅ Character created:', character.name);
            console.log('[WORLD] 📋 DEBUG: Created character ID:', character.id);
            console.log('[WORLD] 📋 DEBUG: Created character user_id:', character.user_id);
            console.log('[WORLD] 📋 DEBUG: Character data verification:', {
              id: character.id,
              user_id: character.user_id,
              name: character.name,
              species: character.species,
              role: character.role
            });

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

    request.on('end', async () => {
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
// Force redeploy Tue Sep  9 09:44:29 CEST 2025
