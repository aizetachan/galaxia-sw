// Función para inicializar base de datos de manera lazy
let pool = null;
let bcrypt = null;
let databaseReady = false;

// Almacenamiento en memoria para modo demo
const demoUsers = new Map();

async function ensureDatabase() {
  if (databaseReady) return true;

  try {
    if (process.env.DATABASE_URL) {
      console.log('[DB] Initializing database connection...');

      // Cargar dependencias solo cuando se necesiten
      const { Pool } = require('pg');
      bcrypt = require('bcrypt');

      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });

      // Probar conexión
      await pool.query('SELECT 1');

      // Crear tablas si no existen
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
      `);

      databaseReady = true;
      console.log('[DB] Database initialized successfully');
      return true;
    } else {
      console.log('[DB] No DATABASE_URL configured - using demo mode');
      return false;
    }
  } catch (error) {
    console.error('[DB] Database initialization failed:', error.message);
    console.log('[DB] Falling back to demo mode');
    return false;
  }
}

export default function handler(request, response) {
  console.log('Handler called with:', request.method, request.url);
  console.log('Full URL:', request.url);
  console.log('Pathname:', request.url ? request.url.split('?')[0] : 'none');

  const path = request.url ? request.url.split('?')[0] : '';

  // Health check - probar diferentes formatos
  if (request.method === 'GET' && (path === '/api/health' || path === '/health')) {
    console.log('[HEALTH] Health endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      message: 'API working',
      timestamp: Date.now(),
      database: !!process.env.DATABASE_URL
    }));
    return;
  }

  // Database test endpoint
  if (request.method === 'GET' && path === '/api/test-db') {
    console.log('[TEST-DB] Database connection test called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');

    try {
      const dbReady = await ensureDatabase();
      if (dbReady) {
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          message: 'Database connection successful',
          mode: 'database'
        }));
      } else {
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          message: 'Demo mode active',
          mode: 'demo',
          database_url: !!process.env.DATABASE_URL
        }));
      }

    } catch (error) {
      console.error('[TEST-DB] Database error:', error);
      response.statusCode = 500;
      response.end(JSON.stringify({
        ok: false,
        error: 'Database initialization failed',
        message: error.message,
        mode: 'error'
      }));
    }
    return;
  }

  // Register endpoint con base de datos o demo
  if (request.method === 'POST' && (path === '/api/auth/register' || path === '/auth/register')) {
    console.log('[REGISTER] Register endpoint called for path:', path);

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      // Parsear el body de la request
      const body = JSON.parse(request.body || '{}');
      const { username, pin } = body;

      if (!username || !pin) {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, error: 'Username and PIN are required' }));
        return;
      }

      // Validar username
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, error: 'Username must be 3-24 characters, alphanumeric + underscore' }));
        return;
      }

      // Validar PIN
      if (!/^\d{4}$/.test(pin)) {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, error: 'PIN must be 4 digits' }));
        return;
      }

      const dbReady = await ensureDatabase();
      if (dbReady && pool && bcrypt) {
        // Modo base de datos
        console.log('[AUTH] Using database mode for registration');

        // Verificar si el usuario ya existe
        const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
          response.statusCode = 409;
          response.end(JSON.stringify({ ok: false, error: 'Username already exists' }));
          return;
        }

        // Hash del PIN
        const pinHash = await bcrypt.hash(pin, 10);

        // Crear usuario
        const result = await pool.query(
          'INSERT INTO users (username, pin_hash) VALUES ($1, $2) RETURNING id, username',
          [username, pinHash]
        );

        const user = result.rows[0];

        console.log(`[AUTH] User registered in DB: ${username} with ID: ${user.id}`);
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          user: { id: user.id, username: user.username },
          message: 'User registered successfully'
        }));

      } else {
        // Modo demo
        console.log('[AUTH] Using demo mode for registration');

        // Verificar si el usuario ya existe en demo
        if (demoUsers.has(username)) {
          response.statusCode = 409;
          response.end(JSON.stringify({ ok: false, error: 'Username already exists' }));
          return;
        }

        // Crear usuario en demo
        const userId = Date.now();
        const user = {
          id: userId,
          username,
          pin, // En demo no hasheamos
          createdAt: new Date()
        };

        demoUsers.set(username, user);

        console.log(`[AUTH] User registered in demo: ${username} with ID: ${userId}`);
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          user: { id: user.id, username: user.username },
          message: 'User registered successfully (demo mode)',
          mode: 'demo'
        }));
      }

    } catch (error) {
      console.error('[AUTH] Register error:', error);
      response.statusCode = 500;
      response.end(JSON.stringify({ ok: false, error: 'Registration failed' }));
    }
    return;
  }

  // Login endpoint con base de datos o demo
  if (request.method === 'POST' && (path === '/api/auth/login' || path === '/auth/login')) {
    console.log('[LOGIN] Login endpoint called for path:', path);

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      // Parsear el body de la request
      const body = JSON.parse(request.body || '{}');
      const { username, pin } = body;

      if (!username || !pin) {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, error: 'Username and PIN are required' }));
        return;
      }

      const dbReady = await ensureDatabase();
      if (dbReady && pool && bcrypt) {
        // Modo base de datos
        console.log('[AUTH] Using database mode for login');

        // Buscar usuario
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
          response.statusCode = 401;
          response.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
          return;
        }

        const user = result.rows[0];

        // Verificar PIN
        const isValidPin = await bcrypt.compare(pin, user.pin_hash);
        if (!isValidPin) {
          response.statusCode = 401;
          response.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
          return;
        }

        console.log(`[AUTH] User logged in from DB: ${username} with ID: ${user.id}`);
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          user: { id: user.id, username: user.username },
          message: 'Login successful'
        }));

      } else {
        // Modo demo
        console.log('[AUTH] Using demo mode for login');

        // Buscar usuario en demo
        const user = demoUsers.get(username);
        if (!user) {
          response.statusCode = 401;
          response.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
          return;
        }

        // Verificar PIN (sin hash en demo)
        if (pin !== user.pin) {
          response.statusCode = 401;
          response.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
          return;
        }

        console.log(`[AUTH] User logged in from demo: ${username} with ID: ${user.id}`);
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          user: { id: user.id, username: user.username },
          message: 'Login successful (demo mode)',
          mode: 'demo'
        }));
      }

    } catch (error) {
      console.error('[AUTH] Login error:', error);
      response.statusCode = 500;
      response.end(JSON.stringify({ ok: false, error: 'Login failed' }));
    }
    return;
  }

  // World endpoints
  if (request.method === 'GET' && (path === '/api/world/characters/me' || path === '/world/characters/me')) {
    console.log('[WORLD] Characters/me endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end('{"ok":true,"characters":[],"message":"No characters found"}');
    return;
  }

  // DM/Master endpoints
  if (request.method === 'POST' && (path === '/api/dm/respond' || path === '/dm/respond')) {
    console.log('[DM] Respond endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.statusCode = 200;
    response.end('{"ok":true,"text":"¡Hola! Soy el Máster de la Galaxia. ¿Estás listo para tu aventura?","stage":"name"}');
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
