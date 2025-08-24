// server/db.js
// Neon (Postgres serverless) con WebSocket para Node
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';                      // WebSocket para Node
neonConfig.webSocketConstructor = ws;

const connectionString = (process.env.DATABASE_URL || '').trim();

export let pool = null;
export let hasDb = false;

if (connectionString) {
  pool = new Pool({ connectionString }); // Neon usa SSL/WS según la URL
  hasDb = true;
} else {
  console.warn('[DB] DATABASE_URL no está definida. DB deshabilitada.');
}

// Helper simple
export const sql = async (text, params) => {
  if (!hasDb) throw new Error('DB_DISABLED');
  return pool.query(text, params);
};

// -------------------- MIGRACIÓN MINIMAL Y TOLERANTE --------------------
async function run(tx) {
  await tx.query('BEGIN');

  // Extensión opcional
  await tx.query(`DO $$
  BEGIN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    EXCEPTION WHEN others THEN NULL;
    END;
  END $$;`);

  // Enum visibility
  await tx.query(`DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'visibility') THEN
      CREATE TYPE visibility AS ENUM ('public','private');
    END IF;
  END $$;`);

  // users
  await tx.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // characters
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

  // events (sin FK todavía)
  await tx.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL,
      actor TEXT NOT NULL,
      location TEXT,
      summary TEXT NOT NULL,
      visibility visibility NOT NULL DEFAULT 'public',
      user_id BIGINT
    );
  `);

  // sessions
  await tx.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ
    );
  `);

  // Índices
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_events_actor_ts ON events(actor, ts DESC);`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_user_id);`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`);

  // Unicidad owner_user_id por si el esquema viene antiguo
  await tx.query(`DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'characters_owner_user_id_key'
    ) THEN
      ALTER TABLE characters ADD CONSTRAINT characters_owner_user_id_key UNIQUE (owner_user_id);
    END IF;
  END $$;`);

  /* ---------- CONVERSIÓN SEGURA DE events.user_id A BIGINT (SI HACE FALTA) ---------- */
  // No comparamos con users.id para evitar TEXT = BIGINT. Solo convertimos la columna.

  await tx.query(`
    DO $$
    DECLARE coltype text;
    BEGIN
      SELECT atttypid::regtype::text INTO coltype
      FROM pg_attribute
      WHERE attrelid = 'events'::regclass
        AND attname = 'user_id'
        AND NOT attisdropped
      LIMIT 1;

      IF coltype IS DISTINCT FROM 'bigint' THEN
        -- Poner a NULL lo no numérico
        BEGIN
          EXECUTE 'UPDATE events SET user_id = NULL WHERE user_id IS NOT NULL AND user_id::text !~ ''^[0-9]+$''';
        EXCEPTION WHEN others THEN NULL;
        END;

        -- Convertir a BIGINT (si se puede). Si no, lo dejamos como esté.
        BEGIN
          EXECUTE 'ALTER TABLE events ALTER COLUMN user_id TYPE BIGINT USING NULLIF(user_id::text, '''')::bigint';
        EXCEPTION WHEN others THEN NULL;
        END;
      END IF;
    END $$;
  `);

  // ⚠️ No añadimos la FK aquí. La pondremos más adelante cuando confirmemos que el tipo quedó en BIGINT.

  await tx.query('COMMIT');
}

export async function migrate({ strict = false } = {}) {
  if (!hasDb) {
    console.warn('[DB] migrate: saltado (DB deshabilitada).');
    return;
  }

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error('[DB] No se pudo conectar. migrate saltado:', err.message);
    if (strict) throw err;
    return;
  }

  try {
    await run(client);
    console.log('[DB] migrate: ok');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[DB] migrate error:', e.message);
    if (strict) throw e;
  } finally {
    client.release();
  }
}
