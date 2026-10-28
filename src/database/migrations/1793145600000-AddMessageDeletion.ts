import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageDeletion1793145600000 implements MigrationInterface {
  /** Preserve message history while allowing deleted messages to have no stored text. */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE chat_messages ALTER COLUMN content DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS "CK_chat_messages_content"',
    );
    await queryRunner.query(`ALTER TABLE chat_messages ADD CONSTRAINT "CK_chat_messages_content" CHECK (
      (deleted_at IS NULL AND content IS NOT NULL AND content ~ '[^[:space:]]')
      OR (deleted_at IS NOT NULL AND content IS NULL)
    )`);
  }

  /** Refuse to undo deletion metadata when the original text has already been removed. */
  async down(queryRunner: QueryRunner): Promise<void> {
    const deleted: unknown[] = await queryRunner.query(
      'SELECT 1 FROM chat_messages WHERE deleted_at IS NOT NULL LIMIT 1',
    );
    if (deleted.length) {
      throw new Error(
        'Cannot revert message deletion while deleted messages exist; their original text is unavailable',
      );
    }
    await queryRunner.query(
      'ALTER TABLE chat_messages DROP CONSTRAINT "CK_chat_messages_content"',
    );
    await queryRunner.query(
      'ALTER TABLE chat_messages ALTER COLUMN content SET NOT NULL',
    );
    await queryRunner.query('ALTER TABLE chat_messages DROP COLUMN deleted_at');
    await queryRunner.query(
      `ALTER TABLE chat_messages ADD CONSTRAINT "CK_chat_messages_content" CHECK (content ~ '[^[:space:]]')`,
    );
  }
}
