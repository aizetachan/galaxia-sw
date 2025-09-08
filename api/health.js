// Función health con respuesta JSON
module.exports = () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  },
  body: JSON.stringify({ ok: true, message: 'Health OK' })
});
