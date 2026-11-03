import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFaqs1793664000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE faq_categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(100) NOT NULL,
      slug varchar(150) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_faq_categories_name" ON faq_categories (name)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_faq_categories_slug" ON faq_categories (slug)',
    );
    await queryRunner.query(`CREATE TABLE faqs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id uuid NOT NULL,
      question varchar(500) NOT NULL,
      answer text NOT NULL,
      alternative_questions text[] NOT NULL DEFAULT '{}'::text[],
      keywords text[] NOT NULL DEFAULT '{}'::text[],
      is_active boolean NOT NULL DEFAULT true,
      display_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_faqs_category" FOREIGN KEY (category_id) REFERENCES faq_categories(id) ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_faqs_category_active_order" ON faqs (category_id, is_active, display_order, id)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE faqs');
    await queryRunner.query('DROP TABLE faq_categories');
  }
}
