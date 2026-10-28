import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import migrationSource from '../data-source.js';
import { InitialSchema1792400000000 } from './1792400000000-InitialSchema.js';
import { seedEntities } from '../../seed.js';
import { UserEntity } from '../../users/entities/user.entity.js';
import { AuthAccountEntity } from '../../auth/entities/auth-account.entity.js';
import { BlogAuditLogEntity } from '../../blogs/entities/blog-audit-log.entity.js';
import { NotificationEntity } from '../../notifications/entities/notification.entity.js';
import { ConversationEntity } from '../../chat/entities/conversation.entity.js';
import { MessageEntity } from '../../chat/entities/message.entity.js';

describe('Initial schema safeguards', () => {
  it('leaves existing core tables untouched', async () => {
    const query = vi.fn();
    const runner = {
      getTables: vi.fn().mockResolvedValue(Array(7).fill({})),
      query,
    } as unknown as QueryRunner;
    await new InitialSchema1792400000000().up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a partial core schema without changing it', async () => {
    const query = vi.fn();
    const runner = {
      getTables: vi.fn().mockResolvedValue([{}]),
      query,
    } as unknown as QueryRunner;
    await expect(new InitialSchema1792400000000().up(runner)).rejects.toThrow(
      'Core schema is incomplete',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to drop adopted tables during rollback', async () => {
    await expect(new InitialSchema1792400000000().down()).rejects.toThrow(
      'cannot be reverted automatically',
    );
  });
});

describe.runIf(process.env.BLOGHUB_RUN_DB_TESTS === '1')(
  'Fresh database migrations',
  () => {
    it('creates the full schema, matches entities, enforces chat rules, and preserves data on rerun', async () => {
      const options = migrationSource.options;
      if (options.type !== 'postgres')
        throw new Error('Expected PostgreSQL configuration');
      const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
      const connection = new DataSource({
        ...options,
        migrations: [],
        installExtensions: false,
      });
      const source = new DataSource({
        ...options,
        schema,
        installExtensions: false,
        uuidExtension: 'pgcrypto',
        entities: [
          ...seedEntities,
          AuthAccountEntity,
          BlogAuditLogEntity,
          NotificationEntity,
          ConversationEntity,
          MessageEntity,
        ],
        extra: { options: `-c search_path=${schema},public` },
      });
      try {
        await connection.initialize();
        await connection.query(`CREATE SCHEMA "${schema}"`);
        await source.initialize();
        const applied = await source.runMigrations();
        expect(applied).toHaveLength(6);
        const tables: { tablename: string }[] = await source.query(
          'SELECT tablename FROM pg_tables WHERE schemaname = $1',
          [schema],
        );
        expect(tables.map((table) => table.tablename).sort()).toEqual(
          [
            ...source.entityMetadatas.map((entity) => entity.tableName),
            'migrations',
          ].sort(),
        );
        expect(
          (await source.driver.createSchemaBuilder().log()).upQueries,
        ).toEqual([]);

        const users = await source.getRepository(UserEntity).save(
          ['alice', 'bob', 'outsider'].map((name) => ({
            displayName: name,
            email: `${name}@migration-test.example`,
          })),
        );
        const [user1Id, user2Id] = [users[0].id, users[1].id].sort();
        const conversation = await source
          .getRepository(ConversationEntity)
          .save({
            user1Id,
            user2Id,
          });
        const messages = source.getRepository(MessageEntity);
        await expect(
          messages.insert({
            conversationId: conversation.id,
            senderId: users[2].id,
            clientMessageId: randomUUID(),
            content: 'Not a participant',
          }),
        ).rejects.toMatchObject({ driverError: { code: '23514' } });
        const message = await messages.save({
          conversationId: conversation.id,
          senderId: users[0].id,
          clientMessageId: randomUUID(),
          content: 'A valid message',
        });
        await messages.update(message.id, {
          content: null,
          deletedAt: new Date(),
        });
        expect(
          (await messages.findOneByOrFail({ id: message.id })).content,
        ).toBeNull();
        await expect(
          messages.update(message.id, { content: 'Restored text' }),
        ).rejects.toMatchObject({ driverError: { code: '23514' } });

        await expect(source.runMigrations()).resolves.toEqual([]);
        const runner = source.createQueryRunner();
        try {
          await new InitialSchema1792400000000().up(runner);
        } finally {
          await runner.release();
        }
        expect(await source.getRepository(UserEntity).count()).toBe(3);
      } finally {
        if (source.isInitialized) await source.destroy();
        if (connection.isInitialized) {
          try {
            await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          } finally {
            await connection.destroy();
          }
        }
      }
    }, 120_000);
  },
);
