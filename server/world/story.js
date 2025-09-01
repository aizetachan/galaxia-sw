// server/world/story.js
import { Router } from 'express';
import { q } from '../db.js';

const router = Router();

// ===========================================================
//                        GameClock
// ===========================================================
router.get('/world/time', async (_req, res) => {
  try {
    const { rows } = await q('SELECT real_to_game_ratio, current_epoch_start, note FROM world_time WHERE id = TRUE');
    const time = rows[0] || null;
    return res.json({ ok: true, time });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
//                    Story variables (KV)
// ===========================================================
router.get('/story/world', async (_req, res) => {
  try {
    const { rows } = await q("SELECT key, value FROM story_variables WHERE scope_type='world'");
    return res.json({ ok: true, vars: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/story/character/:id', async (req, res) => {
  try {
    const cid = req.params.id;
    const { rows } = await q(
      "SELECT key, value FROM story_variables WHERE scope_type='character' AND scope_id=$1",
      [cid]
    );
    return res.json({ ok: true, vars: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/story/:scope/:id?/:key', async (req, res) => {
  try {
    const scope = req.params.scope;
    const key = req.params.key;
    const scopeId = req.params.id || null;
    const value = req.body?.value;
    if (!scope || !key) return res.status(400).json({ ok: false, error: 'scope and key required' });
    await q(
      `INSERT INTO story_variables(scope_type, scope_id, key, value, updated_at)
       VALUES ($1,$2,$3,$4::jsonb, now())
       ON CONFLICT (scope_type, scope_id, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [scope, scopeId, key, JSON.stringify(value)]
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
