import { Pool } from '@neondatabase/serverless';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function sql(query, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(query, params);
    return res;
  } finally {
    client.release();
  }
}

// Run migrations to ensure tables exist
export async function migrate() {
  await sql(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ DEFAULT (now() + interval '30 days')
    );
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      species TEXT,
      role TEXT,
      public_profile BOOLEAN DEFAULT true,
      last_location TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TYPE IF NOT EXISTS visibility AS ENUM ('public','rumor','private');
    CREATE TABLE IF NOT EXISTS world_events (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor TEXT,
      location TEXT,
      summary TEXT,
      visibility visibility NOT NULL DEFAULT 'public',
      user_id TEXT REFERENCES users(id)
    );
  `);
}
