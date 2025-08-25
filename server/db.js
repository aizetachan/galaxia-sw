// server/db.js
import pg from 'pg';
const { Pool } = pg;

// ¿Tenemos cadena de conexión?
export const hasDb = !!process.env.DATABASE_URL;

export let pool = null;
if (hasDb) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // necesario en Neon/Vercel
  });
}

/** sql(text, params) -> pool.query */
export async function sql(text, params = []) {
  if (!hasDb) throw new Error('DB not configured: missing DATABASE_URL');
  return pool.query(text, params);
}

/** Alias por compatibilidad */
export async function q(text, params = []) {
  return sql(text, params);
}
