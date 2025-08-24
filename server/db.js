// server/db.js
import { Pool, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

export const hasDb = !!connectionString;

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

export const sql = (text, params) => pool.query(text, params);

// --- Migración idempotente (incluye messages) ---
async function run(tx) {
  await tx.query('BEGIN');

  // Extensión opcional (no rompe si no hay permisos)
  await tx.query(`DO $$
  BEGIN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END $$;`);

  // Enum visibility si no existe
  await tx.query(`DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'visibility') THEN
      CREATE TYPE visibility AS ENUM ('public','private');
    END IF;
  END $$;`);

  // Tablas base
  await tx.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await tx.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      species TEXT,
      role TEXT,
      public_profile BOOLEAN NOT NULL DEFAULT TRUE,
      last_location TEXT,
      owner_user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await tx.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL,
      actor TEXT NOT NULL,
      location TEXT,
      summary TEXT NOT NULL,
      visibility visibility NOT NULL DEFAULT 'public',
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  await tx.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ
    );
  `);

  /* ======= NUEVO: tabla messages (historial de chat por usuario) ======= */
  await tx.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dm','user')),
      user_label TEXT,               -- 'Máster' o nombre mostrado
      text TEXT NOT NULL
    );
  `);

  // Índices
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_events_actor_ts ON events(actor, ts DESC);`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_user_id);`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_messages_user_ts ON messages(user_id, ts);`);

  // Unicidad owner_user_id aunque la tabla ya existiera
  await tx.query(`DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'characters_owner_user_id_key'
    ) THEN
      ALTER TABLE characters ADD CONSTRAINT characters_owner_user_id_key UNIQUE (owner_user_id);
    END IF;
  END $$;`);

  // Reparación: asegura autoincremento en users.id si faltaba
  await tx.query(`DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name='users' AND column_name='id' AND column_default IS NULL
    ) THEN
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='users_id_seq') THEN
        CREATE SEQUENCE users_id_seq;
      END IF;
      ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('users_id_seq');
      ALTER SEQUENCE users_id_seq OWNED BY users.id;
      PERFORM setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 0) + 1, false);
    END IF;
  END $$;`);

  await tx.query('COMMIT');
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await run(client);
    console.log('[DB] migrate: ok');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[DB] migrate error:', e);
    throw e;
  } finally {
    client.release();
  }
}

/* ======= Helpers de historial ======= */
export async function dbGetMessages(userId, limit = 200) {
  const { rows } = await sql(
    `SELECT ts, kind, user_label, text
       FROM messages
      WHERE user_id = $1
      ORDER BY ts ASC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function dbAppendMessage({ userId, ts, kind, user_label, text }) {
  await sql(
    `INSERT INTO messages (user_id, ts, kind, user_label, text)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, new Date(ts || Date.now()), kind, user_label || null, text]
  );
}

export async function dbReplaceMessages(userId, messages = []) {
  await sql('BEGIN');
  try {
    await sql(`DELETE FROM messages WHERE user_id=$1`, [userId]);
    for (const m of messages) {
      await sql(
        `INSERT INTO messages (user_id, ts, kind, user_label, text)
         VALUES ($1,$2,$3,$4,$5)`,
        [userId, new Date(m.ts || Date.now()), m.kind, m.user || null, m.text]
      );
    }
    await sql('COMMIT');
  } catch (e) {
    await sql('ROLLBACK');
    throw e;
  }
}
