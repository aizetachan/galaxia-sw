// Función serverless básica sin dependencias pesadas
exports.handler = async (event, context) => {
  console.log('[BASIC] Handler called with method:', event.httpMethod, 'path:', event.path);
  console.log('[BASIC] Raw path:', event.rawPath || 'not available');
  console.log('[BASIC] RequestContext:', JSON.stringify(event.requestContext || {}));

  // Normalizar la ruta para manejar diferentes formatos de Vercel
  let path = event.path;
  if (event.rawPath) {
    path = event.rawPath;
  }

  console.log('[BASIC] Normalized path:', path);

  // Health check
  if (event.httpMethod === 'GET' && (path === '/api/health' || path === '/health')) {
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
  if (event.httpMethod === 'POST' && (path === '/api/auth/register' || path === '/auth/register')) {
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
  if (event.httpMethod === 'POST' && (path === '/api/auth/login' || path === '/auth/login')) {
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
  if (event.httpMethod === 'GET' && event.path === '/api/test') {
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
  if (event.httpMethod === 'OPTIONS') {
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
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      ok: false,
      error: 'Not found',
      path: event.path,
      method: event.httpMethod
    })
  };
};
