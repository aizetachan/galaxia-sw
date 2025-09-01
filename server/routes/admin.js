import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// POST /api/admin/seed-character { username?: string, characterId?: string }
router.post('/seed-character', async (req, res) => {
  try {
    const { username, characterId } = req.body || {};
    if (!username && !characterId) {
      return res.status(400).json({ error: 'username o characterId requerido' });
    }

    if (characterId) {
      await pool.query('SELECT seed_character_basics($1::uuid)', [characterId]);
    } else {
      await pool.query('SELECT seed_character_for_user($1::text)', [username]);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'seed failed', detail: String(err) });
  }
});

export default router;
