// Función serverless básica sin dependencias pesadas
exports.handler = async (event, context) => {
  try {
    console.log('[BASIC] Handler called');
    console.log('[BASIC] Event keys:', Object.keys(event));
    console.log('[BASIC] Method:', event.httpMethod || event.method || 'unknown');
    console.log('[BASIC] Path:', event.path || event.rawPath || 'unknown');

    // Normalizar la ruta para manejar diferentes formatos de Vercel
    let path = event.path || event.rawPath || '';
    let method = event.httpMethod || event.method || '';

    console.log('[BASIC] Normalized method:', method, 'path:', path);

    // Health check
    if (method === 'GET' && (path === '/api/health' || path === '/health')) {
      console.log('[HEALTH] Health check called');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          ok: true,
          message: 'API working',
          timestamp: Date.now(),
          path: path
        })
      };
    }

    // Register endpoint (simplified)
    if (method === 'POST' && (path === '/api/auth/register' || path === '/auth/register')) {
      console.log('[AUTH] Register called for path:', path);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          ok: true,
          user: { id: 123, username: 'testuser' },
          message: 'User registered successfully'
        })
      };
    }

    // Login endpoint (simplified)
    if (method === 'POST' && (path === '/api/auth/login' || path === '/auth/login')) {
      console.log('[AUTH] Login called for path:', path);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          ok: true,
          user: { id: 123, username: 'testuser' },
          message: 'Login successful'
        })
      };
    }

    // Test endpoint
    if (method === 'GET' && path === '/api/test') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        },
        body: 'TEST'
      };
    }

    // OPTIONS para CORS
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: ''
      };
    }

    // Respuesta por defecto
    console.log('[BASIC] Route not found for method:', method, 'path:', path);
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ok: false,
        error: 'Not found',
        path: path,
        method: method
      })
    };

  } catch (error) {
    console.error('[BASIC] Handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ok: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
