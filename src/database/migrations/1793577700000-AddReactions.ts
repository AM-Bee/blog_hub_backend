import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReactions1793577700000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE reactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      blog_id uuid,
      comment_id uuid,
      type varchar(7) NOT NULL,
      CONSTRAINT "FK_reactions_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "FK_reactions_blog" FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE,
      CONSTRAINT "FK_reactions_comment" FOREIGN KEY (comment_id) REFERENCES blog_comments(id) ON DELETE CASCADE,
      CONSTRAINT "CK_reactions_target" CHECK ((blog_id IS NOT NULL AND comment_id IS NULL) OR (blog_id IS NULL AND comment_id IS NOT NULL)),
      CONSTRAINT "CK_reactions_type" CHECK (type IN ('like', 'dislike'))
    )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_reactions_blog_user" ON reactions (blog_id, user_id)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_reactions_comment_user" ON reactions (comment_id, user_id)',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_reactions_user" ON reactions (user_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE reactions');
  }
}
