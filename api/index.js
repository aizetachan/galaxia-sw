// Función serverless completamente básica
exports.handler = async (event, context) => {
  console.log('[BASIC] Handler called with method:', event.httpMethod, 'path:', event.path);

  // Solo responder a GET /api/health por ahora
  if (event.httpMethod === 'GET' && event.path === '/api/health') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true,
        message: 'Basic handler working',
        timestamp: Date.now()
      })
    };
  }

  // Respuesta por defecto
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ok: false,
      error: 'Not found',
      path: event.path,
      method: event.httpMethod
    })
  };
};
