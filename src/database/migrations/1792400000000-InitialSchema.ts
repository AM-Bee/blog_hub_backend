import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1792400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.getTables([
      'users',
      'categories',
      'tags',
      'blogs',
      'blog_tags',
      'refresh_sessions',
      'refresh_tokens',
    ]);
    // Older installations already created these tables through synchronization.
    if (existing.length === 7) return;
    if (existing.length) {
      throw new Error(
        'Core schema is incomplete; inspect existing tables before applying the initial migration',
      );
    }
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM('author', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TYPE "users_status_enum" AS ENUM('active', 'disabled')`,
    );
    await queryRunner.query(`CREATE TABLE "users" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "display_name" character varying(100) NOT NULL,
      "email" character varying(254) NOT NULL,
      "password_hash" character varying(60),
      "password_reset_code_hash" character varying(60),
      "password_reset_expires_at" TIMESTAMP WITH TIME ZONE,
      "password_reset_attempts" integer NOT NULL DEFAULT '0',
      "role" "users_role_enum" NOT NULL DEFAULT 'author',
      "status" "users_status_enum" NOT NULL DEFAULT 'active',
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_email" ON "users"  ("email")`,
    );
    await queryRunner.query(`CREATE TABLE "tags" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "name" character varying(100) NOT NULL,
      "normalized_name" character varying(200) NOT NULL,
      "slug" character varying(240) NOT NULL,
      "category_id" uuid NOT NULL,
      "created_by_id" uuid NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_tags_category_id" ON "tags"  ("category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6e2dfaca4aed5f8381e4e7b20" ON "tags"  ("created_by_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tags_slug" ON "tags"  ("slug")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tags_category_normalized_name" ON "tags"  ("category_id", "normalized_name")`,
    );
    await queryRunner.query(`CREATE TABLE "categories" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "name" character varying(100) NOT NULL,
      "normalized_name" character varying(200) NOT NULL,
      "slug" character varying(240) NOT NULL,
      "created_by_id" uuid NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_acec5b500772f0e638240f7087" ON "categories"  ("created_by_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_categories_slug" ON "categories"  ("slug")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_categories_normalized_name" ON "categories"  ("normalized_name")`,
    );
    await queryRunner.query(`CREATE TABLE "blog_tags" (
      "blog_id" uuid NOT NULL,
      "tag_id" uuid NOT NULL,
      CONSTRAINT "PK_561e9296a2ba753a9900831104c" PRIMARY KEY ("blog_id", "tag_id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_blog_tags_tag_id" ON "blog_tags"  ("tag_id")`,
    );
    await queryRunner.query(
      `CREATE TYPE "blogs_status_enum" AS ENUM('draft', 'published')`,
    );
    await queryRunner.query(`CREATE TABLE "blogs" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "author_id" uuid NOT NULL,
      "category_id" uuid,
      "title" character varying(200) NOT NULL,
      "slug" character varying(500) NOT NULL,
      "content" text NOT NULL,
      "cover_image_url" character varying(2048),
      "status" "blogs_status_enum" NOT NULL DEFAULT 'draft',
      "publication_blocked" boolean NOT NULL DEFAULT false,
      "published_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_e113335f11c926da929a625f118" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_b324119dcb71e877cee411f792" ON "blogs"  ("author_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f073a9f9720fe731423f1064c" ON "blogs"  ("category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_blogs_published" ON "blogs"  ("status", "published_at", "id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_blogs_slug" ON "blogs"  ("slug")`,
    );
    await queryRunner.query(`CREATE TABLE "refresh_sessions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "revoked_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_9190032f6967b7971dca07d69f3" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_a7ab4fd82c654c85b9de53d971" ON "refresh_sessions"  ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb0c40963cccc7058fb8f3a7a7" ON "refresh_sessions"  ("expires_at")`,
    );
    await queryRunner.query(`CREATE TABLE "refresh_tokens" (
      "token_hash" character varying(64) NOT NULL,
      "session_id" uuid NOT NULL,
      "used_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_a7838d2ba25be1342091b6695f1" PRIMARY KEY ("token_hash")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_3bf308fa93da3966f9e76fcfba" ON "refresh_tokens"  ("session_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tags" ADD CONSTRAINT "FK_tags_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tags" ADD CONSTRAINT "FK_f6e2dfaca4aed5f8381e4e7b208" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_acec5b500772f0e638240f70874" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blog_tags" ADD CONSTRAINT "FK_blog_tags_blog" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blog_tags" ADD CONSTRAINT "FK_blog_tags_tag" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blogs" ADD CONSTRAINT "FK_blogs_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blogs" ADD CONSTRAINT "FK_blogs_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_sessions" ADD CONSTRAINT "FK_a7ab4fd82c654c85b9de53d971a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3bf308fa93da3966f9e76fcfba4" FOREIGN KEY ("session_id") REFERENCES "refresh_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  async down(): Promise<void> {
    // This migration may have adopted existing tables; reverting must never drop their data.
    throw new Error(
      'The initial schema cannot be reverted automatically; use a backup or a disposable database',
    );
  }
}
