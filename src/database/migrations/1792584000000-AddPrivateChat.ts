import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrivateChat1792584000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = queryRunner.connection.driver.escape(
      (await queryRunner.getCurrentSchema()) ?? 'public',
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS chat_conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user1_id uuid NOT NULL,
      user2_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_chat_conversations_user1" FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT "FK_chat_conversations_user2" FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT "CK_chat_conversations_order" CHECK (user1_id < user2_id)
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_chat_conversations_pair"
      ON chat_conversations (user1_id, user2_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_chat_conversations_user1_updated"
      ON chat_conversations (user1_id, updated_at, id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_chat_conversations_user2_updated"
      ON chat_conversations (user2_id, updated_at, id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL,
      sender_id uuid NOT NULL,
      client_message_id uuid NOT NULL,
      content varchar(2000) NOT NULL,
      is_read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_chat_messages_conversation" FOREIGN KEY (conversation_id)
        REFERENCES chat_conversations(id) ON DELETE CASCADE,
      CONSTRAINT "FK_chat_messages_sender" FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT "CK_chat_messages_content" CHECK (content ~ '[^[:space:]]')
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_chat_messages_sender_client"
      ON chat_messages (sender_id, client_message_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_chat_messages_history"
      ON chat_messages (conversation_id, created_at, id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_chat_messages_unread"
      ON chat_messages (conversation_id, is_read, sender_id)`);

    // A foreign key proves the sender exists; this trigger also proves membership.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION chat_check_message_sender()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM ${schema}.chat_conversations
          WHERE id = NEW.conversation_id AND NEW.sender_id NOT IN (user1_id, user2_id)
        ) THEN
          RAISE EXCEPTION 'Message sender must belong to the conversation'
            USING ERRCODE = '23514', CONSTRAINT = 'CK_chat_messages_sender_participant';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_chat_messages_sender" ON chat_messages',
    );
    await queryRunner.query(`CREATE TRIGGER "TR_chat_messages_sender"
      BEFORE INSERT OR UPDATE OF conversation_id, sender_id ON chat_messages
      FOR EACH ROW EXECUTE FUNCTION chat_check_message_sender()`);

    // Changing participants could expose old messages or invalidate existing senders.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION chat_keep_participants()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.user1_id IS DISTINCT FROM OLD.user1_id OR NEW.user2_id IS DISTINCT FROM OLD.user2_id THEN
          RAISE EXCEPTION 'Conversation participants cannot be changed'
            USING ERRCODE = '23514', CONSTRAINT = 'CK_chat_conversations_fixed_participants';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_chat_conversations_participants" ON chat_conversations',
    );
    await queryRunner.query(`CREATE TRIGGER "TR_chat_conversations_participants"
      BEFORE UPDATE OF user1_id, user2_id ON chat_conversations
      FOR EACH ROW EXECUTE FUNCTION chat_keep_participants()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE chat_messages');
    await queryRunner.query('DROP TABLE chat_conversations');
    await queryRunner.query('DROP FUNCTION chat_check_message_sender()');
    await queryRunner.query('DROP FUNCTION chat_keep_participants()');
  }
}
