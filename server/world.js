import { nanoid } from 'nanoid';
import { pool, migrate } from './db.js';

await migrate();

export async function getWorld() {
  const chars = await pool.query('SELECT owner_user_id, name, species, role, public_profile, last_location FROM characters');
  const events = await pool.query('SELECT id, ts, actor, location, summary, visibility, user_id FROM world_events ORDER BY ts DESC LIMIT 500');
  const characters = {};
  for (const c of chars.rows) {
    characters[c.name] = {
      name: c.name,
      species: c.species,
      role: c.role,
      publicProfile: c.public_profile,
      lastLocation: c.last_location,
      ownerUserId: c.owner_user_id
    };
  }
  return { characters, events: events.rows };
}

export async function upsertCharacter(character) {
  const { ownerUserId, name, species, role, publicProfile = true, lastLocation = null } = character;
  const r = await pool.query(
    `INSERT INTO characters (id, owner_user_id, name, species, role, public_profile, last_location)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (owner_user_id)
     DO UPDATE SET
       name=EXCLUDED.name,
       species=EXCLUDED.species,
       role=EXCLUDED.role,
       public_profile=EXCLUDED.public_profile,
       last_location=EXCLUDED.last_location,
       updated_at=now()
     RETURNING owner_user_id, name, species, role, public_profile, last_location`,
    [nanoid(), ownerUserId, name, species, role, publicProfile, lastLocation]
  );
  const c = r.rows[0];
  return {
    name: c.name,
    species: c.species,
    role: c.role,
    publicProfile: c.public_profile,
    lastLocation: c.last_location,
    ownerUserId: c.owner_user_id
  };
}

export async function appendEvent(evt) {
  const { ts, actor, location, summary, visibility, userId } = evt;
  await pool.query(
    `INSERT INTO world_events (ts, actor, location, summary, visibility, user_id)
     VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6)`,
    [ts || Date.now(), actor, location, summary, visibility, userId || null]
  );
}

export async function getCharacterByOwner(ownerUserId) {
  const r = await pool.query(
    'SELECT owner_user_id, name, species, role, public_profile, last_location FROM characters WHERE owner_user_id=$1',
    [ownerUserId]
  );
  if (!r.rowCount) return null;
  const c = r.rows[0];
  return {
    name: c.name,
    species: c.species,
    role: c.role,
    publicProfile: c.public_profile,
    lastLocation: c.last_location,
    ownerUserId: c.owner_user_id
  };
}
