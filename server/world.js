// server/world.js
import crypto from 'crypto';
import { sql } from './db.js';

function uuid() {
  return crypto.randomUUID();
}

export async function upsertCharacter(char) {
  const id = char.id || uuid();
  const now = new Date().toISOString();
  const owner = char.ownerUserId;

  // Upsert por owner_user_id (único)
  const { rows } = await sql(
    `INSERT INTO characters (id, owner_user_id, name, species, role, public_profile, last_location, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (owner_user_id) DO UPDATE SET
       name=EXCLUDED.name,
       species=EXCLUDED.species,
       role=EXCLUDED.role,
       public_profile=EXCLUDED.public_profile,
       last_location=EXCLUDED.last_location,
       updated_at=EXCLUDED.updated_at
     RETURNING *`,
    [
      id, owner, char.name, char.species || null, char.role || null,
      char.publicProfile ?? true, char.lastLocation || null, now
    ]
  );
  return normalizeCharacter(rows[0]);
}

export async function getCharacterByOwner(ownerUserId) {
  const { rows } = await sql(
    `SELECT * FROM characters WHERE owner_user_id=$1 LIMIT 1`,
    [ownerUserId]
  );
  return rows[0] ? normalizeCharacter(rows[0]) : null;
}

export async function appendEvent(evt) {
  await sql(
    `INSERT INTO world_events (ts, actor, location, summary, visibility, user_id)
     VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6)`,
    [evt.ts, evt.actor, evt.location, evt.summary, evt.visibility || 'public', evt.userId || null]
  );
}

export async function getWorld() {
  const charsQ = sql(`SELECT * FROM characters ORDER BY updated_at ASC`);
  const eventsQ = sql(`SELECT EXTRACT(EPOCH FROM ts)*1000 AS ts, actor, location, summary, visibility FROM world_events ORDER BY ts ASC`);
  const [charsRes, eventsRes] = await Promise.all([charsQ, eventsQ]);

  const characters = {};
  for (const r of charsRes.rows) {
    const c = normalizeCharacter(r);
    characters[c.name] = c;
  }
  const events = eventsRes.rows.map(e => ({
    ts: Math.round(Number(e.ts)),
    actor: e.actor, location: e.location, summary: e.summary, visibility: e.visibility
  }));
  return { characters, events };
}

function normalizeCharacter(r) {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    name: r.name,
    species: r.species || '',
    role: r.role || '',
    publicProfile: !!r.public_profile,
    lastLocation: r.last_location || '',
    updatedAt: r.updated_at
  };
}
