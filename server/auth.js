// Autenticación ultra-simple para debugging
const express = require('express');

const router = express.Router();

console.log('[AUTH] Ultra-simple auth module loaded');

// POST /auth/register - ultra simple
router.post('/register', (req, res) => {
  console.log('[AUTH] Register called with body:', !!req.body);
  res.json({
    ok: true,
    user: { id: 123, username: 'testuser' },
    message: 'Registration successful (simplified)'
  });
});

// POST /auth/login - ultra simple
router.post('/login', (req, res) => {
  console.log('[AUTH] Login called with body:', !!req.body);
  res.json({
    ok: true,
    user: { id: 123, username: 'testuser' },
    message: 'Login successful (simplified)'
  });
});

// POST /auth/logout - ultra simple
router.post('/logout', (req, res) => {
  console.log('[AUTH] Logout called');
  res.json({ ok: true, message: 'Logged out successfully' });
});

// GET /auth/me - ultra simple
router.get('/me', (req, res) => {
  console.log('[AUTH] Me called');
  res.json({
    ok: true,
    user: { id: 123, username: 'testuser' }
  });
});

module.exports = router;
