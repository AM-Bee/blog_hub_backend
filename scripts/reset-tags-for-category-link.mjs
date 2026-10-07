// One-time reset explicitly requested when tags gain required parent categories.
// This deletes every tag. It is never run by application startup.
import dotenv from 'dotenv';
import pg from 'pg';

if (!process.argv.includes('--delete-existing-tags')) {
  throw new Error(
    'This reset deletes all tags. Supply --delete-existing-tags explicitly.',
  );
}
dotenv.config({ quiet: true });
const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('LOCK TABLE tags IN ACCESS EXCLUSIVE MODE');
  const references = await client.query(
    "SELECT conname FROM pg_constraint WHERE confrelid = 'tags'::regclass AND contype = 'f'",
  );
  if (references.rowCount)
    throw new Error('Other tables reference tags; reset cancelled');
  const deleted = await client.query('DELETE FROM tags');
  await client.query(
    'ALTER TABLE tags ADD COLUMN IF NOT EXISTS category_id uuid',
  );
  await client.query('ALTER TABLE tags ALTER COLUMN category_id SET NOT NULL');
  await client.query('DROP INDEX IF EXISTS "UQ_tags_normalized_name"');
  await client.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tags_category_normalized_name" ON tags (category_id, normalized_name)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS "IDX_tags_category_id" ON tags (category_id)',
  );
  await client.query(
    'ALTER TABLE tags DROP CONSTRAINT IF EXISTS "FK_tags_category"',
  );
  await client.query(
    'ALTER TABLE tags ADD CONSTRAINT "FK_tags_category" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE',
  );
  await client.query('COMMIT');
  console.log(
    JSON.stringify({ deletedTags: deleted.rowCount, relationshipAdded: true }),
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Tag reset failed:', error.code ?? error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
