import 'dotenv/config';
import pg from 'pg';
import { isUUID } from 'class-validator';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit trusted bootstrap only; no HTTP endpoint can create a main admin.
export async function makeSuperAdmin(client, id) {
  if (!isUUID(id)) throw new Error('Pass the UUID of an existing active admin');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(1793750400)');
    const { rows } = await client.query(
      "SELECT id FROM users WHERE role = 'super_admin'",
    );
    if (rows.some((user) => user.id !== id))
      throw new Error('A different main admin already exists');
    const result = await client.query(
      "UPDATE users SET role = 'super_admin', permissions = '{}', updated_at = now() WHERE id = $1 AND role IN ('admin', 'super_admin') AND status = 'active' RETURNING id",
      [id],
    );
    if (!result.rowCount)
      throw new Error('User must be an existing active admin');
    await client.query('COMMIT');
    return { id, role: 'super_admin' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const id = process.argv[2];
  if (!isUUID(id ?? ''))
    throw new Error('Usage: npm run admin:make-super -- <admin-uuid>');
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:
      process.env.DB_SSL === 'true'
        ? {
            ca: process.env.DB_SSL_CA_FILE
              ? readFileSync(process.env.DB_SSL_CA_FILE, 'utf8')
              : undefined,
          }
        : false,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    console.log(JSON.stringify(await makeSuperAdmin(client, id)));
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error('Main admin setup failed:', error.code ?? error.message);
    process.exitCode = 1;
  });
}
