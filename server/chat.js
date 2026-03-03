// Chat con base de datos
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

// Configuración de la base de datos
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('[CHAT] Database connected for chat');
  } catch (error) {
    console.error('[CHAT] Database connection error:', error.message);
  }
}

// Importar middleware de autenticación desde auth.js (evita duplicación)
const { authenticateToken } = require('./auth');

// GET /chat/history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    if (!pool) {
      return res.json({
        ok: true,
        message: 'Chat history not available (requires database)',
        messages: []
      });
    }

    // Obtener los últimos 50 mensajes del usuario
    const result = await pool.query(`
      SELECT cm.*, c.name as character_name
      FROM chat_messages cm
      LEFT JOIN characters c ON cm.character_id = c.id
      WHERE cm.user_id = $1
      ORDER BY cm.ts DESC
      LIMIT 50
    `, [req.user.id]);

    // Revertir el orden para mostrar los más antiguos primero
    const messages = result.rows.reverse().map(row => ({
      id: row.id,
      role: row.role,
      text: row.text,
      ts: row.ts.toISOString(),
      character_name: row.character_name
    }));

    console.log('[CHAT] Retrieved', messages.length, 'messages for user:', req.user.username);

    res.json({
      ok: true,
      messages: messages,
      message: `Historial cargado: ${messages.length} mensajes`
    });
  } catch (error) {
    console.error('[CHAT] Error fetching history:', error);
    res.status(500).json({
      ok: false,
      error: 'SERVER_ERROR',
      message: 'Error al obtener historial'
    });
  }
});

// POST /chat/message
router.post('/message', authenticateToken, async (req, res) => {
  try {
    if (!pool) {
      return res.json({
        ok: true,
        message: 'Message not saved (requires database)',
        id: Date.now()
      });
    }

    const { text, role = 'user' } = req.body;

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_DATA',
        message: 'Texto del mensaje requerido'
      });
    }

    // Obtener el character_id del usuario si existe
    let characterId = null;
    try {
      const charResult = await pool.query(
        'SELECT id FROM characters WHERE user_id = $1',
        [req.user.id]
      );
      if (charResult.rows.length > 0) {
        characterId = charResult.rows[0].id;
      }
    } catch (error) {
      console.log('[CHAT] Could not get character ID:', error.message);
    }

    // Guardar el mensaje
    const result = await pool.query(`
      INSERT INTO chat_messages (user_id, character_id, role, text)
      VALUES ($1, $2, $3, $4)
      RETURNING id, ts
    `, [req.user.id, characterId, role, text]);

    const savedMessage = result.rows[0];
    console.log('[CHAT] Message saved for user:', req.user.username, 'ID:', savedMessage.id);

    res.json({
      ok: true,
      id: savedMessage.id,
      ts: savedMessage.ts.toISOString(),
      message: 'Mensaje guardado exitosamente'
    });
  } catch (error) {
    console.error('[CHAT] Error saving message:', error);
    res.status(500).json({
      ok: false,
      error: 'SERVER_ERROR',
      message: 'Error al guardar mensaje'
    });
  }
});

module.exports = router;
