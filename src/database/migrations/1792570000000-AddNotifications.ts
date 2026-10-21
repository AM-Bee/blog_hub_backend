import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotifications1792570000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      type varchar(32) NOT NULL,
      blog_id uuid NOT NULL,
      blog_title varchar(200) NOT NULL,
      message text NOT NULL,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_notifications_user" FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_user_created"
      ON notifications (user_id, created_at, id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_user_read"
      ON notifications (user_id, read_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE notifications');
  }
}
