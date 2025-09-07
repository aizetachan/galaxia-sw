// Función serverless ultrarrápida para health check
export default async function handler(event, context) {
  // Respuesta inmediata sin logging para máxima velocidad
  const method = event.httpMethod;

  if (method === 'OPTIONS') {
    // Handle preflight requests
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
      body: ''
    };
  }

  if (method === 'GET') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        message: 'Health check successful'
      })
    };
  }

  // Método no soportado
  return {
    statusCode: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      ok: false,
      error: 'Method not allowed'
    })
  };
}
