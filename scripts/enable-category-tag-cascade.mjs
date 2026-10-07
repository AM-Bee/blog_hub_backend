// Change only the category/tag foreign key. Existing records are preserved.
import dotenv from 'dotenv';
import pg from 'pg';

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
  await client.query(
    'ALTER TABLE tags DROP CONSTRAINT IF EXISTS "FK_tags_category"',
  );
  await client.query(
    'ALTER TABLE tags ADD CONSTRAINT "FK_tags_category" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE',
  );
  await client.query('COMMIT');
  console.log(
    'Category/tag foreign key now uses ON DELETE CASCADE; existing records preserved.',
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Cascade update failed:', error.code ?? error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
