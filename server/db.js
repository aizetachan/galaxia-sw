// server/db.js
import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon necesita SSL
});

export async function sql(q, params = []) {
  const c = await pool.connect();
  try {
    return await c.query(q, params);
  } finally {
    c.release();
  }
}

// Evitar correr migraciones varias veces
let migrated = false;
export async function migrate() {
  if (migrated) return;
  migrated = true;

  // 1) Tablas base
  await sql(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
    );
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      species TEXT,
      role TEXT,
      public_profile BOOLEAN DEFAULT TRUE,
      last_location TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 2) Enum sin conflictos (NO usar "users" como tipo)
  await sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_visibility') THEN
        CREATE TYPE event_visibility AS ENUM ('public','rumor','private');
      END IF;
    END $$;
  `);

  // 3) Eventos del mundo
  await sql(`
    CREATE TABLE IF NOT EXISTS world_events (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL,
      actor TEXT,
      location TEXT,
      summary TEXT,
      visibility event_visibility NOT NULL DEFAULT 'public',
      user_id TEXT REFERENCES users(id)
    );
  `);
}
