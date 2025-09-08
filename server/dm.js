// Máster IA (placeholder básico)
const express = require('express');
const router = express.Router();

// POST /dm/respond
router.post('/respond', (req, res) => {
  // Placeholder - implementar con OpenAI más tarde
  res.json({
    ok: true,
    text: 'Hola, soy el Máster. Esta es una respuesta de prueba. Implementaré la lógica completa con OpenAI pronto.'
  });
});

// GET /dm/resume
router.get('/resume', (req, res) => {
  res.json({
    ok: true,
    resume: 'Resumen de sesión no disponible (requiere BD)'
  });
});

module.exports = router;
