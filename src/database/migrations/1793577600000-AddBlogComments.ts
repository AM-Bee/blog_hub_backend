import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlogComments1793577600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE blog_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      blog_id uuid NOT NULL,
      user_id uuid NOT NULL,
      parent_id uuid,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_blog_comments_blog" FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE,
      CONSTRAINT "FK_blog_comments_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "FK_blog_comments_parent" FOREIGN KEY (parent_id) REFERENCES blog_comments(id) ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_blog_comments_thread" ON blog_comments (blog_id, parent_id, created_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_blog_comments_user" ON blog_comments (user_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE blog_comments');
  }
}
