// Función CommonJS para health check
function handler(event, context) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      ok: true,
      timestamp: Date.now(),
      message: 'Health check successful'
    })
  };
}

module.exports = handler;
