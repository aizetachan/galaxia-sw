// server/db.js
import pg from 'pg';
const { Pool } = pg;

// Database connection options
const {
  DATABASE_URL,
  PG_MAX = '10',
  PG_IDLE_TIMEOUT = '30000',
  PG_CONNECTION_TIMEOUT = '2000',
} = process.env;

export const hasDb = !!DATABASE_URL;

export let pool = null;
if (hasDb) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: parseInt(PG_MAX, 10),
    idleTimeoutMillis: parseInt(PG_IDLE_TIMEOUT, 10),
    connectionTimeoutMillis: parseInt(PG_CONNECTION_TIMEOUT, 10),
    ssl: { rejectUnauthorized: false },
  });

  // Log unexpected errors on the idle client
  pool.on('error', (err) => {
    console.error('PG pool error', err);
  });
}

export async function sql(text, params = []) {
  if (!hasDb) throw new Error('DB not configured: missing DATABASE_URL');
  return pool.query(text, params);
}
export async function q(text, params = []) { return sql(text, params); }
