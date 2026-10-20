import type { MigrationInterface, QueryRunner } from 'typeorm';

// Incremental migration: the existing BlogHub tables must already exist.
export class AddGoogleAccounts1792454400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL',
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        provider varchar(20) NOT NULL,
        provider_account_id varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_auth_accounts_user" FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_auth_accounts_provider_identity"
      ON auth_accounts (provider, provider_account_id)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_auth_accounts_user_provider"
      ON auth_accounts (user_id, provider)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL refuses this if passwordless users exist; never invent passwords.
    await queryRunner.query(
      'ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL',
    );
    await queryRunner.query('DROP TABLE auth_accounts');
  }
}
