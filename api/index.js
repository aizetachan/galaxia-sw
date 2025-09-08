// Configuración simple de base de datos
let pool = null;
const demoUsers = new Map();

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('[DB] Database configured');
  } catch (error) {
    console.error('[DB] Database setup error:', error.message);
  }
} else {
  console.log('[DB] No DATABASE_URL - using demo mode');
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
    console.log('[TEST-DB] Database test called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');

    if (pool) {
      response.statusCode = 200;
      response.end('{"ok":true,"message":"Database configured","mode":"database"}');
    } else {
      response.statusCode = 200;
      response.end('{"ok":true,"message":"Demo mode","mode":"demo"}');
    }
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

      request.on('end', () => {
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

          // Simular registro exitoso
          const userId = Date.now();
          const tokenData = { id: userId, username: username, timestamp: Date.now() };
          const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');
          response.statusCode = 200;
          response.end(JSON.stringify({
            ok: true,
            user: { id: userId, username: username },
            token: token,
            message: 'Usuario registrado exitosamente'
          }));

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

      request.on('end', () => {
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

          // Simular autenticación exitosa
          const userId = Date.now();
          const tokenData = { id: userId, username: username, timestamp: Date.now() };
          const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');
          response.statusCode = 200;
          response.end(JSON.stringify({
            ok: true,
            user: { id: userId, username: username },
            token: token,
            message: 'Login exitoso'
          }));

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

    // Extraer información del token
    let username = 'unknown_user';
    let userId = 12345;

    try {
      // Decodificar token base64
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      userId = decoded.id || 12345;
      username = decoded.username || 'unknown_user';
      console.log('[AUTH] Token decoded successfully:', { userId, username });
    } catch (error) {
      console.error('[AUTH] Error decoding token:', error);
      username = 'unknown_user';
      userId = 12345;
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
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      userId = decoded.id || 12345;
      username = decoded.username || 'unknown_user';
    } catch (error) {
      console.error('[WORLD] Error decoding token:', error);
    }

    // Simular respuesta de personajes (en producción buscaría en BD)
    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      character: null, // No hay personaje guardado aún
      message: `No character found for user: ${username}`
    }));
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

    // Simular historial vacío (en producción vendría de BD)
    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      messages: [],
      message: 'Chat history loaded'
    }));
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

        // Simular guardado exitoso
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          character: {
            id: Date.now(),
            name: data.name || data.character?.name,
            species: data.species || data.character?.species,
            role: data.role || data.character?.role,
            publicProfile: data.publicProfile || data.character?.publicProfile || true,
            lastLocation: data.lastLocation || data.character?.lastLocation,
            userId: 12345
          },
          message: 'Personaje guardado exitosamente'
        }));
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

        // Simular respuesta del DM
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          text: "¡Hola! Soy el Máster de la Galaxia. ¿Estás listo para tu aventura?",
          stage: "name"
        }));
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
