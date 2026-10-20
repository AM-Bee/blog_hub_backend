import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlogAuditLogs1792490000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS blog_audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      blog_id uuid NOT NULL,
      blog_title varchar(200) NOT NULL,
      actor_id uuid NOT NULL,
      post_author_id uuid NOT NULL,
      action varchar(20) NOT NULL,
      changes jsonb NOT NULL,
      snapshot jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_blog_audit_logs_actor_created"
      ON blog_audit_logs (actor_id, created_at, id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_blog_audit_logs_blog"
      ON blog_audit_logs (blog_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE blog_audit_logs');
  }
}
