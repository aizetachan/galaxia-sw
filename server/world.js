// Mundo vivo (placeholder - requiere BD)
const express = require('express');
const router = express.Router();

// GET /world/state
router.get('/state', (req, res) => {
  res.json({
    ok: true,
    message: 'World state not available (requires database)',
    state: {}
  });
});

// GET /world/characters/me
router.get('/characters/me', (req, res) => {
  res.json({
    ok: true,
    message: 'Characters not available (requires database)',
    characters: []
  });
});

module.exports = router;
