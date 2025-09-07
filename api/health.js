// Función CommonJS para probar
function handler(event, context) {
  return {
    statusCode: 200,
    body: 'OK'
  };
}

module.exports = handler;
