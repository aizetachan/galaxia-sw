// Función serverless básica sin dependencias pesadas
exports.handler = async (event, context) => {
  console.log('[BASIC] Handler called with method:', event.httpMethod, 'path:', event.path);

  // Health check
  if (event.httpMethod === 'GET' && event.path === '/api/health') {
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
        timestamp: Date.now()
      })
    };
  }

  // Register endpoint (simplified)
  if (event.httpMethod === 'POST' && event.path === '/api/auth/register') {
    console.log('[AUTH] Register called');
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
  if (event.httpMethod === 'POST' && event.path === '/api/auth/login') {
    console.log('[AUTH] Login called');
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
