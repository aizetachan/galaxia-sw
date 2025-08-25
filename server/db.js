// server/db.js
import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL no está definida');
}

// Neon / Postgres serverless suele requerir SSL
export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Helper opcional
export async function q(sql, params = []) {
  const t0 = Date.now();
  const res = await pool.query(sql, params);
  res.latencyMs = Date.now() - t0;
  return res;
}
