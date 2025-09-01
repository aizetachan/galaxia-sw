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
    const id = req.params.id;

    const { rows: charRows } = await q('SELECT id FROM characters WHERE id=$1', [id]);
    if (!charRows.length) return res.status(404).json({ ok: false, error: 'Personaje no encontrado' });

    const [attr, resources, location, inventory, qp, wsv, csv] = await Promise.all([
      q('SELECT attr, value FROM character_attributes WHERE character_id=$1', [id]),
      q('SELECT hp, energy, morale, hunger, credits FROM character_resources WHERE character_id=$1', [id]),
      q(`SELECT l.id, l.name, l.type, l.parent_id, l.props, cl.last_seen_at
           FROM character_location cl
           JOIN locations l ON l.id = cl.location_id
          WHERE cl.character_id=$1`, [id]),
      q(`SELECT ci.qty, ci.equipped_slot, ii.id as "itemInstanceId", idf.code, idf.name, idf.type
           FROM character_inventory ci
           JOIN item_instances ii ON ci.item_instance_id = ii.id
           JOIN item_defs idf ON idf.id = ii.item_def_id
          WHERE ci.character_id=$1`, [id]),
      q(`SELECT qp.state, qp.updated_at, qp.objective_id, q.id as "questId", q.code, q.title, q.description
           FROM quest_progress qp
           JOIN quests q ON q.id = qp.quest_id
          WHERE qp.character_id=$1`, [id]),
      q(`SELECT key, value FROM story_variables WHERE scope_type='world'`),
      q(`SELECT key, value FROM story_variables WHERE scope_type='character' AND scope_id=$1`, [id])
    ]);

    const quests = {
      active: qp.rows.filter(r => r.state !== 'completed' && r.state !== 'failed'),
      completed: qp.rows.filter(r => r.state === 'completed')
    };

    res.json({
      ok: true,
      state: {
        attributes: attr.rows,
        resources: resources.rows[0] || null,
        location: location.rows[0] || null,
        inventory: inventory.rows,
        quests,
        storyVars: { world: wsv.rows, character: csv.rows }
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/characters/:id/state', async (req, res) => {
  try {
    const id = req.params.id;
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
//                    Movement
// ===========================================================
router.post('/characters/:id/move', async (req, res) => {
  try {
    const id = req.params.id;
    const to = req.body?.to_location_id;
    if (!to) return res.status(400).json({ ok: false, error: 'to_location_id requerido' });

    const { rows: curRows } = await q('SELECT location_id FROM character_location WHERE character_id=$1', [id]);
    if (!curRows.length) return res.status(404).json({ ok: false, error: 'character_location no encontrado' });
    const cur = curRows[0].location_id;
    const { rows: linkRows } = await q('SELECT 1 FROM location_links WHERE from_id=$1 AND to_id=$2', [cur, to]);
    if (!linkRows.length) return res.status(400).json({ ok: false, error: 'movimiento no permitido' });

    await q('UPDATE character_location SET location_id=$2, last_seen_at=now() WHERE character_id=$1', [id, to]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
//                    Inventory
// ===========================================================
router.post('/characters/:id/inventory/give', async (req, res) => {
  try {
    const id = req.params.id;
    const { item_def_code, qty } = req.body || {};
    const quantity = Number(qty) || 1;
    const { rows: defRows } = await q('SELECT id, stackable FROM item_defs WHERE code=$1', [item_def_code]);
    if (!defRows.length) return res.status(400).json({ ok: false, error: 'item_def no encontrado' });
    const def = defRows[0];
    const added = [];
    if (def.stackable) {
      const { rows: instRows } = await q('INSERT INTO item_instances(item_def_id) VALUES ($1) RETURNING id', [def.id]);
      const instId = instRows[0].id;
      await q(`INSERT INTO character_inventory(character_id, item_instance_id, qty)
               VALUES ($1,$2,$3)
               ON CONFLICT (character_id, item_instance_id) DO UPDATE SET qty = character_inventory.qty + EXCLUDED.qty`,
               [id, instId, quantity]);
      added.push({ itemInstanceId: instId, qty: quantity });
    } else {
      for (let i = 0; i < quantity; i++) {
        const { rows: instRows } = await q('INSERT INTO item_instances(item_def_id) VALUES ($1) RETURNING id', [def.id]);
        const instId = instRows[0].id;
        await q('INSERT INTO character_inventory(character_id, item_instance_id, qty) VALUES ($1,$2,1)', [id, instId]);
        added.push({ itemInstanceId: instId, qty: 1 });
      }
    }
    return res.json({ ok: true, items: added });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/characters/:id/inventory/use', async (req, res) => {
  try {
    const id = req.params.id;
    const { item_instance_id } = req.body || {};
    if (!item_instance_id) return res.status(400).json({ ok: false, error: 'item_instance_id requerido' });
    const { rows } = await q(
      `SELECT ci.qty, idf.use_effect
         FROM character_inventory ci
         JOIN item_instances ii ON ii.id = ci.item_instance_id
         JOIN item_defs idf ON idf.id = ii.item_def_id
        WHERE ci.character_id=$1 AND ci.item_instance_id=$2`,
      [id, item_instance_id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'item no encontrado' });
    const { qty, use_effect } = rows[0];
    if (use_effect?.heal) {
      await q('UPDATE character_resources SET hp = LEAST(100, hp + $2), updated_at=now() WHERE character_id=$1', [id, use_effect.heal]);
    }
    const { rows: upRows } = await q('UPDATE character_inventory SET qty = qty - 1 WHERE character_id=$1 AND item_instance_id=$2 RETURNING qty', [id, item_instance_id]);
    if (upRows[0].qty <= 0) {
      await q('DELETE FROM character_inventory WHERE character_id=$1 AND item_instance_id=$2', [id, item_instance_id]);
      await q('DELETE FROM item_instances WHERE id=$1', [item_instance_id]);
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
//                    Resources
// ===========================================================
router.patch('/characters/:id/resources', async (req, res) => {
  try {
    const id = req.params.id;
    const allowed = ['hp', 'energy', 'morale', 'hunger', 'credits'];
    const fields = [];
    const values = [id];
    allowed.forEach((k) => {
      if (req.body && req.body[k] !== undefined) {
        let v = Number(req.body[k]);
        if (k !== 'credits') {
          if (k === 'hp' || k === 'energy') v = Math.max(0, Math.min(100, v));
          if (k === 'morale') v = Math.max(0, Math.min(100, v));
          if (k === 'hunger') v = Math.max(0, Math.min(100, v));
        }
        values.push(v);
        fields.push(`${k}=$${values.length}`);
      }
    });
    if (!fields.length) return res.status(400).json({ ok: false, error: 'sin cambios' });
    const { rows } = await q(`UPDATE character_resources SET ${fields.join(', ')}, updated_at=now() WHERE character_id=$1 RETURNING hp, energy, morale, hunger, credits`, values);
    return res.json({ ok: true, resources: rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
//                    Quests
// ===========================================================
router.post('/characters/:id/quests/accept', async (req, res) => {
  try {
    const id = req.params.id;
    const { code } = req.body || {};
    const { rows: qRows } = await q('SELECT id FROM quests WHERE code=$1', [code]);
    if (!qRows.length) return res.status(404).json({ ok: false, error: 'quest no encontrada' });
    const questId = qRows[0].id;
    const { rows: objRows } = await q('SELECT id FROM quest_objectives WHERE quest_id=$1 ORDER BY idx LIMIT 1', [questId]);
    const objectiveId = objRows[0]?.id || null;
    await q(`INSERT INTO quest_progress(character_id, quest_id, objective_id, state)
             VALUES ($1,$2,$3,'active')
             ON CONFLICT DO NOTHING`, [id, questId, objectiveId]);
    return res.json({ ok: true, questId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/characters/:id/quests/:questId/progress', async (req, res) => {
  try {
    const id = req.params.id;
    const questId = req.params.questId;
    const { objective_id, state } = req.body || {};
    await q(`UPDATE quest_progress SET state=$1, updated_at=now()
             WHERE character_id=$2 AND quest_id=$3 AND objective_id=$4`, [state, id, questId, objective_id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/characters/:id/quests', async (req, res) => {
  try {
    const id = req.params.id;
    const { rows } = await q(`SELECT qp.state, qp.updated_at, qp.objective_id, q.id as "questId", q.code, q.title, q.description
                               FROM quest_progress qp
                               JOIN quests q ON q.id = qp.quest_id
                              WHERE qp.character_id=$1`, [id]);
    return res.json({ ok: true, quests: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
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
