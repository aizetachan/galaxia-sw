// server/db.js
import { Pool, neonConfig } from '@neondatabase/serverless';

// Cachea la conexión entre invocaciones (recomendado en serverless)
neonConfig.fetchConnectionCache = true;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

export const pool = new Pool({
  connectionString,            // usa la URL de Neon con ?sslmode=require
  ssl: { rejectUnauthorized: false },
});

// --- Migración idempotente ---
async function run(tx) {
  await tx.query('BEGIN');

  // Extensión opcional (si no hay permisos, se ignora)
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
      owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
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

  await tx.query(`CREATE INDEX IF NOT EXISTS idx_events_actor_ts ON events(actor, ts DESC);`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_user_id);`);

  await tx.query('COMMIT');
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await run(client);
    console.log('DB migrate: ok');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('DB migrate error:', e);
    throw e;
  } finally {
    client.release();
  }
}
