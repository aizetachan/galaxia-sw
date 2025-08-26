// server/chat.js
import { Router } from 'express';
import { q } from './db.js';
import { requireAuth } from './auth.js';

const router = Router();

/**
 * Devuelve el histórico del usuario autenticado
 * /api/chat/history?limit=200
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth.userId);
    const limit = Math.min(Number(req.query.limit || 200), 500);

    const { rows } = await q(
      `SELECT role, text, ts
         FROM chat_messages
        WHERE user_id = $1
        ORDER BY ts ASC
        LIMIT $2`,
      [userId, limit]
    );

    return res.json({ ok: true, messages: rows });
  } catch (e) {
    console.error('[CHAT/history] error', e);
    return res.status(500).json({ error: 'history_failed' });
  }
});

export default router;
