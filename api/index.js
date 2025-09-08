// Función serverless ultra-simple para debugging
const serverless = require('serverless-http');
const express = require('express');

const app = express();

// Middleware básico
app.use(express.json());

// Endpoint de prueba
app.get('/test', (req, res) => {
  console.log('[SIMPLE] Test endpoint called');
  res.json({ ok: true, message: 'Simple serverless function working' });
});

// Endpoint de health
app.get('/health', (req, res) => {
  console.log('[SIMPLE] Health check called');
  res.json({ ok: true, timestamp: Date.now() });
});

// Endpoint de register simplificado
app.post('/auth/register', (req, res) => {
  console.log('[SIMPLE] Register called');
  res.json({
    ok: true,
    user: { id: 123, username: 'testuser' },
    message: 'Registration successful'
  });
});

// Endpoint de login simplificado
app.post('/auth/login', (req, res) => {
  console.log('[SIMPLE] Login called');
  res.json({
    ok: true,
    user: { id: 123, username: 'testuser' },
    message: 'Login successful'
  });
});

console.log('[SIMPLE] Ultra-simple serverless function loaded');

module.exports = serverless(app);
