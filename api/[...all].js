// Función serverless catch-all usando CommonJS
function handler(event, context) {
  console.log('[CATCH-ALL] Request received:', event.httpMethod, event.path);

  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    },
    body: JSON.stringify({
      ok: false,
      error: 'Endpoint not found',
      message: 'Esta ruta API no está implementada aún',
      path: event.path,
      method: event.httpMethod
    })
  };
}

module.exports = handler;
