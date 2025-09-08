// Chat (placeholder - requiere BD)
const express = require('express');
const router = express.Router();

// GET /chat/history
router.get('/history', (req, res) => {
  res.json({
    ok: true,
    message: 'Chat history not available (requires database)',
    messages: []
  });
});

// POST /chat/message
router.post('/message', (req, res) => {
  res.json({
    ok: true,
    message: 'Message not saved (requires database)',
    id: Date.now()
  });
});

module.exports = router;
