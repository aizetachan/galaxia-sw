// Función de prueba completamente separada
const serverless = require('serverless-http');
const express = require('express');

const app = express();

console.log('[TEST-FUNCTION] Separate test function loaded');

// Endpoint GET
app.get('/test-get', (req, res) => {
  console.log('[TEST-FUNCTION] GET endpoint called');
  res.json({ ok: true, method: 'GET', message: 'GET works' });
});

// Endpoint POST
app.post('/test-post', (req, res) => {
  console.log('[TEST-FUNCTION] POST endpoint called');
  res.json({ ok: true, method: 'POST', message: 'POST works' });
});

module.exports = serverless(app);
