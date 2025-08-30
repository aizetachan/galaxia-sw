// server/world/context.js
import { Router } from 'express';
import { q } from '../db.js';
import { ensureInt } from './utils.js';

const router = Router();

// ===========================================================
//                    Contexto del mundo
// ===========================================================
router.get('/world/context', async (req, res) => {
  try {
    const characterId = ensureInt(req.query.character_id);
    const limit = Math.min(ensureInt(req.query.limit, 20) || 20, 100);
    if (!characterId) return res.status(400).json({ ok: false, error: 'character_id requerido' });

    const { rows: charRows } = await q(
      `SELECT c.*, cs.attrs, cs.inventory, cs.tags
         FROM characters c
         LEFT JOIN character_state cs ON cs.character_id = c.id
        WHERE c.id = $1`,
      [characterId]
    );
    if (!charRows.length) return res.status(404).json({ ok: false, error: 'Personaje no encontrado' });
    const character = charRows[0];

    const { rows: nearby } = await q(
      `SELECT e.*
         FROM events e
        WHERE e.visibility = 'public'
          AND e.location IS NOT NULL
          AND e.location = $1
        ORDER BY e.ts DESC
        LIMIT $2`,
      [character.last_location || null, limit]
    );

    const { rows: facEvents } = await q(
      `SELECT e.*
         FROM faction_memberships fm
         JOIN events e ON e.visibility = 'faction' AND e.faction_id = fm.faction_id
        WHERE fm.character_id = $1
        ORDER BY e.ts DESC
        LIMIT $2`,
      [characterId, limit]
    );

    const { rows: targeted } = await q(
      `SELECT e.*
         FROM event_targets t
         JOIN events e ON e.id = t.event_id
        WHERE t.target_character_id = $1
        ORDER BY e.ts DESC
        LIMIT $2`,
      [characterId, limit]
    );

    const { rows: myActs } = await q(
      `SELECT e.*
         FROM events e
        WHERE e.actor_character_id = $1
        ORDER BY e.ts DESC
        LIMIT $2`,
      [characterId, Math.min(limit, 10)]
    );

    const { rows: unreadRows } = await q(
      `SELECT COUNT(*)::int AS c
         FROM (
           SELECT e.id
             FROM event_targets t
             JOIN events e ON e.id = t.event_id
            WHERE t.target_character_id = $1
           UNION
           SELECT e.id
             FROM faction_memberships fm
             JOIN events e ON e.visibility = 'faction' AND e.faction_id = fm.faction_id
            WHERE fm.character_id = $1
           UNION
           SELECT e.id
             FROM events e
             JOIN characters c ON c.id = $1
            WHERE e.visibility = 'public' AND e.location = c.last_location
         ) x
         LEFT JOIN event_reads r ON r.event_id = x.id AND r.character_id = $1
        WHERE r.event_id IS NULL`,
      [characterId]
    );

    res.json({
      ok: true,
      character,
      nearby_events: nearby,
      faction_events: facEvents,
      targeted_events: targeted,
      recent_actor_events: myActs,
      unread_count: unreadRows?.[0]?.c ?? 0
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
//                         Inbox
// ===========================================================
router.get('/world/inbox', async (req, res) => {
  try {
    const characterId = ensureInt(req.query.character_id);
    const limit = Math.min(ensureInt(req.query.limit, 50) || 50, 200);
    if (!characterId) return res.status(400).json({ ok: false, error: 'character_id requerido' });

    const { rows } = await q(
      `SELECT e.*
         FROM (
           SELECT e.id
             FROM event_targets t
             JOIN events e ON e.id = t.event_id
            WHERE t.target_character_id = $1
           UNION
           SELECT e.id
             FROM faction_memberships fm
             JOIN events e ON e.visibility = 'faction' AND e.faction_id = fm.faction_id
            WHERE fm.character_id = $1
           UNION
           SELECT e.id
             FROM events e
             JOIN characters c ON c.id = $1
            WHERE e.visibility = 'public' AND e.location = c.last_location
         ) x
         LEFT JOIN event_reads r ON r.event_id = x.id AND r.character_id = $1
         JOIN events e ON e.id = x.id
        WHERE r.event_id IS NULL
        ORDER BY e.ts DESC
        LIMIT $2`,
      [characterId, limit]
    );

    res.json({ ok: true, events: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/events/read', async (req, res) => {
  try {
    const cid = ensureInt(req.body?.character_id);
    const eid = ensureInt(req.body?.event_id);
    if (!cid || !eid) return res.status(400).json({ ok: false, error: 'character_id y event_id requeridos' });
    await q(
      `INSERT INTO event_reads(character_id, event_id, read_at)
       VALUES ($1,$2,now())
       ON CONFLICT (character_id, event_id) DO NOTHING`,
      [cid, eid]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
