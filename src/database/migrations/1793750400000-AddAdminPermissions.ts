import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAdminPermissions1793750400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS 'super_admin'`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN permissions text[] NOT NULL DEFAULT '{}'`,
    );
  }
  async down(): Promise<void> {
    throw new Error(
      'Manual rollback required: explicitly reassign the main admin before removing its role and permissions',
    );
  }
}
