import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { isEmail } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function readAdminConfig(env) {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const displayName = env.ADMIN_DISPLAY_NAME?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || !isEmail(email) || email.length > 254) {
    throw new Error('Set ADMIN_EMAIL to a valid email address in .env');
  }
  if (!displayName || [...displayName].length > 100) {
    throw new Error(
      'Set ADMIN_DISPLAY_NAME to a nonblank name of at most 100 characters in .env',
    );
  }
  if (
    !password ||
    [...password].length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error(
      'Set ADMIN_PASSWORD to at least 8 characters and at most 72 UTF-8 bytes in .env',
    );
  }
  return { email, displayName, password };
}

export async function seedAdmin(client, env) {
  const { email, displayName, password } = readAdminConfig(env);
  const lookup = () =>
    client.query(
      'SELECT id, email, display_name AS "displayName", role FROM users WHERE email = $1',
      [email],
    );
  const existing = await lookup();
  if (existing.rows[0]) return existingAdmin(existing.rows[0]);

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await client.query(
    `INSERT INTO users (id, email, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, display_name AS "displayName", role`,
    [randomUUID(), email, displayName, passwordHash],
  );
  if (result.rows[0]) return { status: 'created', admin: result.rows[0] };
  // Resolve a concurrent insert without promoting authors or replacing passwords.
  const concurrent = await lookup();
  if (!concurrent.rows[0])
    throw new Error('Admin creation conflicted; rerun the command');
  return existingAdmin(concurrent.rows[0]);
}

function existingAdmin(user) {
  if (user.role !== 'admin') {
    throw new Error(
      'ADMIN_EMAIL belongs to an author. Choose a different email; existing authors are not promoted automatically.',
    );
  }
  return { status: 'already-exists', admin: user };
}

async function main() {
  dotenv.config({ quiet: true });
  // Validate before opening the database connection.
  readAdminConfig(process.env);
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
    console.log(JSON.stringify(await seedAdmin(client, process.env), null, 2));
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error('Admin seed failed:', error.code ?? error.message);
    process.exitCode = 1;
  });
}
