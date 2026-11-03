import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostSync1793664100000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const schema = runner.connection.driver.escape(
      (await runner.getCurrentSchema()) ?? 'public',
    );
    await runner.query(
      `ALTER TABLE blogs ADD COLUMN version integer NOT NULL DEFAULT 1`,
    );
    await runner.query(`CREATE FUNCTION increment_blog_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.version := OLD.version + 1; RETURN NEW; END; $$`);
    await runner.query(
      `CREATE TRIGGER blogs_version BEFORE UPDATE ON blogs FOR EACH ROW EXECUTE FUNCTION increment_blog_version()`,
    );
    await runner.query(`CREATE FUNCTION touch_blog_tags_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          UPDATE ${schema}.blogs SET version = version WHERE id = OLD.blog_id;
          RETURN OLD;
        END IF;
        UPDATE ${schema}.blogs SET version = version WHERE id = NEW.blog_id;
        RETURN NEW;
      END; $$`);
    await runner.query(
      `CREATE TRIGGER blog_tags_version AFTER INSERT OR DELETE ON blog_tags FOR EACH ROW EXECUTE FUNCTION touch_blog_tags_version()`,
    );
    await runner.query(`CREATE TABLE post_sync_operations (
      user_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      request_hash text NOT NULL,
      result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_post_sync_operations" PRIMARY KEY (user_id, operation_id),
      CONSTRAINT "FK_post_sync_operations_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await runner.query(
      `ALTER TABLE post_sync_operations ENABLE ROW LEVEL SECURITY`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE post_sync_operations');
    await runner.query('DROP TRIGGER blog_tags_version ON blog_tags');
    await runner.query('DROP FUNCTION touch_blog_tags_version()');
    await runner.query('DROP TRIGGER blogs_version ON blogs');
    await runner.query('DROP FUNCTION increment_blog_version()');
    await runner.query('ALTER TABLE blogs DROP COLUMN version');
  }
}
