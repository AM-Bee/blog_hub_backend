import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlogTrash1793836800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE blogs ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by_id uuid',
    );
    await runner.query(
      'CREATE INDEX "IDX_blogs_trash" ON blogs (author_id, deleted_at, id)',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('LOCK TABLE blogs IN ACCESS EXCLUSIVE MODE');
    const [row] = await runner.query(
      'SELECT EXISTS (SELECT 1 FROM blogs WHERE deleted_at IS NOT NULL) AS occupied',
    );
    if (row.occupied)
      throw new Error(
        'Restore or permanently delete all trashed posts before reverting this migration',
      );
    await runner.query('DROP INDEX "IDX_blogs_trash"');
    await runner.query(
      'ALTER TABLE blogs DROP COLUMN deleted_by_id, DROP COLUMN deleted_at',
    );
  }
}
