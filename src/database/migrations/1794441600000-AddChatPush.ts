import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatPush1794441600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const schema = runner.connection.driver.escape(
      (await runner.getCurrentSchema()) ?? 'public',
    );
    await runner.query(`CREATE TABLE push_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL,
      expo_push_token varchar(255) NOT NULL, user_id uuid NOT NULL, session_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_push_devices_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "FK_push_devices_session" FOREIGN KEY (session_id) REFERENCES refresh_sessions(id) ON DELETE CASCADE
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_push_devices_device" ON push_devices (device_id)',
    );
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_push_devices_token" ON push_devices (expo_push_token)',
    );
    await runner.query(
      'CREATE INDEX "IDX_push_devices_user_session" ON push_devices (user_id, session_id)',
    );
    await runner.query(`CREATE TABLE push_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL, registration_id uuid NOT NULL,
      sender_display_name varchar(100) NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0, receipt_checks integer NOT NULL DEFAULT 0,
      ticket_id varchar(255), last_error varchar(80), next_attempt_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_push_jobs_message" FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
      CONSTRAINT "FK_push_jobs_registration" FOREIGN KEY (registration_id) REFERENCES push_devices(id) ON DELETE CASCADE
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_push_jobs_message_device" ON push_jobs (message_id, registration_id)',
    );
    await runner.query(
      'CREATE INDEX "IDX_push_jobs_due" ON push_jobs (status, next_attempt_at, id)',
    );
    // A database trigger covers logout, password resets, token reuse, and admin session revocation alike.
    await runner.query(`CREATE FUNCTION revoke_session_push_devices() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM ${schema}.push_devices WHERE session_id = NEW.id; RETURN NEW; END; $$`);
    await runner.query(`CREATE TRIGGER refresh_sessions_push_cleanup AFTER UPDATE OF revoked_at ON refresh_sessions
      FOR EACH ROW WHEN (NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION revoke_session_push_devices()`);
    await runner.query('ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY');
    await runner.query('ALTER TABLE push_jobs ENABLE ROW LEVEL SECURITY');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TRIGGER refresh_sessions_push_cleanup ON refresh_sessions',
    );
    await runner.query('DROP FUNCTION revoke_session_push_devices()');
    await runner.query('DROP TABLE push_jobs');
    await runner.query('DROP TABLE push_devices');
  }
}
