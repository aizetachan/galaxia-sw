// server/world/characters.js
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { q } from '../db.js';
import { optionalAuth } from '../auth.js';
import {
  ensureInt,
  pick,
  rollFormula,
  outcomeFromDC,
  applyStatePatch,
  s,
} from './utils.js';

const router = Router();

// ===========================================================
//    Perfil del personaje del usuario logueado (GET /me)
// ===========================================================
router.get('/world/characters/me', optionalAuth, async (req, res) => {
  try {
    const userId = req.auth?.userId || null;
    if (!userId) return res.status(200).json({ ok: true, character: null });

    const { rows } = await q(
      `SELECT id, name, species, role,
              public_profile AS "publicProfile",
              last_location AS "lastLocation",
              owner_user_id AS "ownerUserId"
         FROM characters
        WHERE owner_user_id = $1
        LIMIT 1`,
      [userId]
    );
    return res.status(200).json({ ok: true, character: rows[0] || null });
  } catch (e) {
    console.error('[WORLD] /world/characters/me error:', e?.message || e);
    return res.status(200).json({ ok: true, character: null });
  }
});

// ===========================================================
//      Crear/actualizar personaje (POST /world/characters)
//      Arreglado: siempre generamos id en INSERT
// ===========================================================
router.post('/world/characters', optionalAuth, async (req, res) => {
  const hasAuth = !!req.auth?.userId;
  const userId = req.auth?.userId || null;

  try {
    const c = req.body?.character || {};
    const name = s(c.name, 80);
    const species = s(c.species, 40);
    const role = s(c.role, 40);
    const publicProfile = typeof c.publicProfile === 'boolean' ? c.publicProfile : true;
    const lastLocation = s(c.lastLocation, 120);

    // Logging útil
    console.log('[WORLD] POST /characters INCOMING', {
      hasAuth,
      userId,
      bodyKeys: Object.keys(req.body || {}),
      normalized: { name, species, role, publicProfile, lastLocation }
    });

    if (userId) {
      // UPSERT por owner_user_id; en INSERT aportamos id manualmente
      const newId = randomUUID();
      const { rows } = await q(
        `INSERT INTO characters (id, name, species, role, public_profile, last_location, owner_user_id)
              VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (owner_user_id) DO UPDATE
             SET name=COALESCE(EXCLUDED.name, characters.name),
                 species=COALESCE(EXCLUDED.species, characters.species),
                 role=COALESCE(EXCLUDED.role, characters.role),
                 public_profile=EXCLUDED.public_profile,
                 last_location=COALESCE(EXCLUDED.last_location, characters.last_location),
                 updated_at=now()
         RETURNING id, name, species, role,
                   public_profile AS "publicProfile",
                   last_location AS "lastLocation",
                   owner_user_id AS "ownerUserId"`,
        [newId, name, species, role, publicProfile, lastLocation, userId]
      );
      return res.status(200).json({ ok: true, character: rows[0] });
    }

    // Invitado: INSERT con id manual
    const newId = randomUUID();
    const { rows } = await q(
      `INSERT INTO characters (id, name, species, role, public_profile, last_location)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, species, role,
                 public_profile AS "publicProfile",
                 last_location AS "lastLocation",
                 owner_user_id AS "ownerUserId"`,
      [newId, name, species, role, publicProfile, lastLocation]
    );
    return res.status(200).json({ ok: true, character: rows[0] });
  } catch (e) {
    console.error('[WORLD] /characters DB error:', e?.message || e);
    return res.status(200).json({ ok: false, error: 'world_save_failed' });
  }
});

// ===========================================================
//                         State
// ===========================================================
router.get('/characters/:id/state', async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    const { rows } = await q(
      `SELECT c.*, cs.attrs, cs.inventory, cs.tags
         FROM characters c
         LEFT JOIN character_state cs ON cs.character_id = c.id
        WHERE c.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Personaje no encontrado' });
    res.json({ ok: true, character: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/characters/:id/state', async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    const { patch = {}, note = null, event_id = null } = req.body || {};
    const { rows: curRows } = await q(
      `SELECT COALESCE(cs.attrs,'{}'::jsonb) AS attrs,
              COALESCE(cs.inventory,'[]'::jsonb) AS inventory,
              COALESCE(cs.tags,'{}'::text[]) AS tags
         FROM character_state cs
        WHERE cs.character_id = $1`,
      [id]
    );
    const current = curRows[0] || { attrs: {}, inventory: [], tags: [] };
    const merged = applyStatePatch(current, patch);

    await q(
      `INSERT INTO character_state(character_id, attrs, inventory, tags, updated_at)
            VALUES ($1,$2::jsonb,$3::jsonb,$4::text[],now())
       ON CONFLICT (character_id) DO UPDATE SET
            attrs=EXCLUDED.attrs,
            inventory=EXCLUDED.inventory,
            tags=EXCLUDED.tags,
            updated_at=now()`,
      [id, JSON.stringify(merged.attrs || {}), JSON.stringify(merged.inventory || []), merged.tags || []]
    );
    await q(
      `INSERT INTO character_state_history(character_id, event_id, patch, note)
       VALUES ($1,$2,$3::jsonb,$4)`,
      [id, event_id, JSON.stringify(patch || {}), note]
    );

    res.json({ ok: true, state: merged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
//                    Tiradas & Eventos
// ===========================================================
router.post('/rolls', async (req, res) => {
  try {
    const { character_id, user_id, skill = null, formula, target_dc = null } = req.body || {};
    const cid = ensureInt(character_id);
    const uid = ensureInt(user_id);
    if (!cid || !formula) return res.status(400).json({ ok: false, error: 'character_id y formula requeridos' });
    const detail = rollFormula(formula);
    const outcome = outcomeFromDC(detail.total, ensureInt(target_dc));
    const { rows } = await q(
      `INSERT INTO dice_rolls(character_id,user_id,skill,formula,target_dc,roll_detail,outcome)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING *`,
      [cid, uid, skill, formula, ensureInt(target_dc), JSON.stringify(detail), outcome]
    );
    res.json({ ok: true, roll: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/events', async (req, res) => {
  try {
    const b = req.body || {};
    const allowed = pick(b, [
      'summary',
      'kind',
      'visibility',
      'location',
      'actor_character_id',
      'payload',
      'faction_id'
    ]);
    if (!allowed.summary) return res.status(400).json({ ok: false, error: 'summary requerido' });
    if (!allowed.visibility) allowed.visibility = 'public';
    const payload = allowed.payload ? JSON.stringify(allowed.payload) : null;

    const { rows: evRows } = await q(
      `INSERT INTO events(ts, actor, location, summary, visibility, user_id, actor_character_id, kind, payload, faction_id)
       VALUES (now(), COALESCE($1,'system'), $2, $3, $4, NULL, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [
        b.actor || null,
        allowed.location || null,
        allowed.summary,
        allowed.visibility,
        ensureInt(allowed.actor_character_id),
        allowed.kind || null,
        payload,
        ensureInt(allowed.faction_id)
      ]
    );
    const event = evRows[0];

    const targets = Array.isArray(b.targets) ? b.targets.map(ensureInt).filter(Boolean) : [];
    if (targets.length) {
      const values = targets.map((t, i) => `($1,$${i + 2})`).join(',');
      await q(
        `INSERT INTO event_targets(event_id, target_character_id)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [event.id, ...targets]
      );
    }

    res.json({ ok: true, event, targets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
//                         Timeline
// ===========================================================
router.get('/characters/:id/timeline', async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    const limit = Math.min(ensureInt(req.query.limit, 100) || 100, 300);
    const [a, b, c, d] = await Promise.all([
      q(
        `SELECT e.*, 'event_actor' AS kind
           FROM events e
          WHERE e.actor_character_id = $1
          ORDER BY e.ts DESC
          LIMIT $2`,
        [id, limit]
      ),
      q(
        `SELECT e.*, 'event_target' AS kind
           FROM event_targets t
           JOIN events e ON e.id = t.event_id
          WHERE t.target_character_id = $1
          ORDER BY e.ts DESC
          LIMIT $2`,
        [id, limit]
      ),
      q(
        `SELECT h.*, 'state_change' AS kind
           FROM character_state_history h
          WHERE h.character_id = $1
          ORDER BY h.ts DESC
          LIMIT $2`,
        [id, limit]
      ),
      q(
        `SELECT r.*, 'roll' AS kind
           FROM dice_rolls r
          WHERE r.character_id = $1
          ORDER BY r.ts DESC
          LIMIT $2`,
        [id, limit]
      )
    ]);
    const merged = [
      ...a.rows.map((x) => ({ ...x, ts: x.ts || x.created_at })),
      ...b.rows.map((x) => ({ ...x, ts: x.ts || x.created_at })),
      ...c.rows,
      ...d.rows
    ]
      .sort((x, y) => new Date(y.ts) - new Date(x.ts))
      .slice(0, limit);
    res.json({ ok: true, items: merged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
