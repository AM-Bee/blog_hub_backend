import 'reflect-metadata';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { seedEntities } from '../seed.js';
import { AuthAccountEntity } from '../auth/entities/auth-account.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { BlogEntity } from '../blogs/entities/blog.entity.js';
import { BlogAuditLogEntity } from '../blogs/entities/blog-audit-log.entity.js';
import { BlogsModule } from '../blogs/blogs.module.js';
import { NotificationsModule } from './notifications.module.js';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { AddNotifications1792570000000 } from '../database/migrations/1792570000000-AddNotifications.js';

// Real guards/SQL/transactions, confined to a new temporary schema. No email or Google calls.
const schema = `notifications_test_${randomUUID().replaceAll('-', '')}`;
let database: DataSource;
let connection: DataSource;
let app: INestApplication;
let owner: UserEntity;
let other: UserEntity;
let admin: UserEntity;
let category: CategoryEntity;
let ownerToken: string;
let otherToken: string;
let adminToken: string;
@Global()
@Module({
  providers: [{ provide: DataSource, useFactory: () => database }],
  exports: [DataSource],
})
class TestDatabaseModule {}

const list = (token = ownerToken, query = '') =>
  request(app.getHttpServer())
    .get(`/api/v1/me/notifications${query}`)
    .set('Authorization', `Bearer ${token}`);
const read = (id: string, token = ownerToken) =>
  request(app.getHttpServer())
    .patch(`/api/v1/me/notifications/${id}/read`)
    .set('Authorization', `Bearer ${token}`);
const readAll = (token = ownerToken) =>
  request(app.getHttpServer())
    .patch('/api/v1/me/notifications/read-all')
    .set('Authorization', `Bearer ${token}`);
const moderate = (id: string, status = 'draft') =>
  request(app.getHttpServer())
    .patch(`/api/v1/admin/blogs/${id}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status });
const remove = (id: string, token = adminToken) =>
  request(app.getHttpServer())
    .delete(`/api/v1/blogs/${id}`)
    .set('Authorization', `Bearer ${token}`);
async function createPost(token = ownerToken) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/blogs')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Test post ${randomUUID()}`,
      content: 'Private test content',
      categoryId: category.id,
    })
    .expect(201);
  return response.body;
}
async function addNotification(userId: string, createdAt = new Date()) {
  return database
    .getRepository(NotificationEntity)
    .save({
      userId,
      blogId: randomUUID(),
      blogTitle: 'Saved title',
      type: NotificationType.POST_DELETED,
      message: 'An admin deleted your post.',
      readAt: null,
      createdAt,
    });
}

describe.runIf(process.env.BLOGHUB_RUN_DB_TESTS === '1')(
  'Notifications PostgreSQL/HTTP',
  () => {
    beforeAll(async () => {
      dotenv.config({ quiet: true });
      vi.stubEnv('JWT_SECRET', 'notifications-test-secret-at-least-32-bytes');
      vi.stubEnv('FRONTEND_ORIGINS', 'http://localhost:3000');
      const options = {
        type: 'postgres' as const,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5433),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        installExtensions: false,
        connectTimeoutMS: 5000,
      };
      connection = await new DataSource(options).initialize();
      await connection.query(`CREATE SCHEMA "${schema}"`);
      database = await new DataSource({
        ...options,
        schema,
        entities: [
          ...seedEntities,
          AuthAccountEntity,
          BlogAuditLogEntity,
          NotificationEntity,
        ],
        synchronize: true,
      }).initialize();
      const passwordHash = await bcrypt.hash('Password123!', 4);
      const user = (email: string, role = UserRole.AUTHOR) =>
        database.getRepository(UserEntity).save({
          email,
          displayName: email.split('@')[0],
          role,
          passwordHash,
        });
      owner = await user('owner@example.com');
      other = await user('other@example.com');
      admin = await user('admin@example.com', UserRole.ADMIN);
      category = await database
        .getRepository(CategoryEntity)
        .save({
          name: 'Dancing',
          normalizedName: 'dancing',
          slug: 'dancing',
          createdById: owner.id,
        });
      const module = await Test.createTestingModule({
        imports: [TestDatabaseModule, BlogsModule, NotificationsModule],
      }).compile();
      app = module.createNestApplication();
      app.useLogger(false);
      app.setGlobalPrefix('api/v1');
      await app.init();
      async function login(account: UserEntity) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', 'http://localhost:3000')
          .send({ email: account.email, password: 'Password123!' })
          .expect(200);
        return response.body.accessToken;
      }
      ownerToken = await login(owner);
      otherToken = await login(other);
      adminToken = await login(admin);
    }, 30000);
    beforeEach(async () => {
      await database.getRepository(NotificationEntity).clear();
      await database.getRepository(BlogAuditLogEntity).clear();
    });
    afterAll(async () => {
      await app?.close();
      if (database?.isInitialized) await database.destroy();
      if (connection?.isInitialized) {
        await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await connection.destroy();
      }
      vi.unstubAllEnvs();
    });

    it('requires authentication on all routes and validates pagination and IDs', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/me/notifications')
        .expect(401);
      await request(app.getHttpServer())
        .patch('/api/v1/me/notifications/read-all')
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/api/v1/me/notifications/${randomUUID()}/read`)
        .expect(401);
      expect((await list().expect(200)).body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
        unreadCount: 0,
      });
      for (const query of [
        '?page=0',
        '?page=1.5',
        '?page=1000001',
        '?limit=51',
        `?userId=${other.id}`,
      ]) {
        await list(ownerToken, query).expect(400);
      }
      await read('invalid-uuid').expect(400);
      await read(randomUUID()).expect(404);
    });

    it('notifies the owner on unpublish/block, skips unchanged actions, and does not notify on publish', async () => {
      const post = await createPost();
      await moderate(post.id).expect(200);
      await moderate(post.id).expect(200);
      const response = (await list().expect(200)).body;
      expect(response).toMatchObject({ total: 1, unreadCount: 1 });
      expect(response.items[0]).toMatchObject({
        userId: owner.id,
        type: 'post_unpublished',
        blogId: post.id,
        blogTitle: post.title,
        readAt: null,
      });
      expect(response.items[0].message).toContain(post.title);
      expect(response.items[0].message).toContain('only an admin can publish');
      expect(JSON.stringify(response)).not.toContain('Private test content');
      expect((await list(adminToken).expect(200)).body.total).toBe(0);
      expect((await list(otherToken).expect(200)).body.total).toBe(0);
      await moderate(post.id, 'published').expect(200);
      expect((await list().expect(200)).body.total).toBe(1);
      await moderate(post.id).expect(200);
      expect((await list().expect(200)).body.total).toBe(2); // A new moderation action may notify again.
    });

    it('preserves delete notifications after the post disappears and keeps the admin audit separate', async () => {
      const post = await createPost();
      await remove(post.id).expect(204);
      expect(
        await database.getRepository(BlogEntity).existsBy({ id: post.id }),
      ).toBe(false);
      const response = (await list().expect(200)).body;
      expect(response.items[0]).toMatchObject({
        userId: owner.id,
        type: 'post_deleted',
        blogId: post.id,
        blogTitle: post.title,
      });
      expect(
        await database
          .getRepository(BlogAuditLogEntity)
          .countBy({ blogId: post.id, actorId: admin.id }),
      ).toBe(1);
      expect(
        await database
          .getRepository(BlogAuditLogEntity)
          .countBy({ blogId: post.id, actorId: owner.id }),
      ).toBe(0);
      await read(response.items[0].id).expect(200);
    });

    it('does not notify for author self-actions or admin self-actions', async () => {
      const post = await createPost();
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${post.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'published' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${post.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'draft' })
        .expect(200);
      await remove(post.id, ownerToken).expect(204);
      const ownAdminPost = await createPost(adminToken);
      await moderate(ownAdminPost.id).expect(200);
      await remove(ownAdminPost.id).expect(204);
      expect(await database.getRepository(NotificationEntity).count()).toBe(0);
    });

    it('paginates newest first while unreadCount counts all of the recipient unread rows', async () => {
      const oldest = await addNotification(
        owner.id,
        new Date('2026-01-01T00:00:00Z'),
      );
      const newest = await addNotification(
        owner.id,
        new Date('2026-02-01T00:00:00Z'),
      );
      await addNotification(other.id);
      const response = (await list(ownerToken, '?page=1&limit=1').expect(200))
        .body;
      expect(response).toMatchObject({
        total: 2,
        totalPages: 2,
        unreadCount: 2,
      });
      expect(response.items[0].id).toBe(newest.id);
      expect(
        (await list(ownerToken, '?page=2&limit=1').expect(200)).body.items[0]
          .id,
      ).toBe(oldest.id);
      const beyond = (await list(ownerToken, '?page=3&limit=1').expect(200))
        .body;
      expect(beyond).toMatchObject({ items: [], total: 2, unreadCount: 2 });
    });

    it('marks a recipient notification once and hides it from other users and admins', async () => {
      const notification = await addNotification(owner.id);
      await read(notification.id, otherToken).expect(404);
      await read(notification.id, adminToken).expect(404);
      expect((await list().expect(200)).body.unreadCount).toBe(1);
      const first = (await read(notification.id).expect(200)).body;
      expect(first.readAt).toEqual(expect.any(String));
      const second = (await read(notification.id).expect(200)).body;
      expect(second.readAt).toBe(first.readAt);
      expect((await list().expect(200)).body.unreadCount).toBe(0);
    });

    it('marks all only for the current user, preserves already-read timestamps, and is repeatable', async () => {
      const alreadyRead = await addNotification(owner.id);
      const first = (await read(alreadyRead.id).expect(200)).body;
      await addNotification(owner.id);
      await addNotification(owner.id);
      await addNotification(other.id);
      expect((await readAll().expect(200)).body.updated).toBe(2);
      expect((await readAll().expect(200)).body.updated).toBe(0);
      expect((await list().expect(200)).body.unreadCount).toBe(0);
      expect((await list(otherToken).expect(200)).body.unreadCount).toBe(1);
      expect((await read(alreadyRead.id).expect(200)).body.readAt).toBe(
        first.readAt,
      );
    });

    it('serializes identical concurrent unpublishes and creates one notification', async () => {
      const post = await createPost();
      await Promise.all([
        moderate(post.id).expect(200),
        moderate(post.id).expect(200),
      ]);
      expect(
        await database
          .getRepository(NotificationEntity)
          .countBy({ blogId: post.id }),
      ).toBe(1);
      expect(
        await database
          .getRepository(BlogAuditLogEntity)
          .countBy({ blogId: post.id }),
      ).toBe(1);
    });

    it('rolls back moderation and deletion, including audit rows, when notification insertion fails', async () => {
      const post = await createPost();
      await database.query(`CREATE FUNCTION "${schema}".reject_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'notification unavailable'; END; $$`);
      await database.query(`CREATE TRIGGER reject_notification BEFORE INSERT ON "${schema}".notifications
      FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_notification()`);
      try {
        await moderate(post.id).expect(500);
        expect(
          (
            await database
              .getRepository(BlogEntity)
              .findOneByOrFail({ id: post.id })
          ).publicationBlocked,
        ).toBe(false);
        await remove(post.id).expect(500);
        expect(
          await database.getRepository(BlogEntity).existsBy({ id: post.id }),
        ).toBe(true);
        expect(await database.getRepository(BlogAuditLogEntity).count()).toBe(
          0,
        );
        expect(await database.getRepository(NotificationEntity).count()).toBe(
          0,
        );
      } finally {
        await database.query(
          `DROP TRIGGER reject_notification ON "${schema}".notifications`,
        );
        await database.query(`DROP FUNCTION "${schema}".reject_notification()`);
      }
    });

    it('rolls back the notification and audit record if deleting the live post fails afterward', async () => {
      const post = await createPost();
      await database.query(`CREATE FUNCTION "${schema}".reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'delete unavailable'; END; $$`);
      await database.query(`CREATE TRIGGER reject_delete BEFORE DELETE ON "${schema}".blogs
      FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_delete()`);
      try {
        await remove(post.id).expect(500);
        expect(
          await database.getRepository(BlogEntity).existsBy({ id: post.id }),
        ).toBe(true);
        expect(await database.getRepository(NotificationEntity).count()).toBe(
          0,
        );
        expect(await database.getRepository(BlogAuditLogEntity).count()).toBe(
          0,
        );
      } finally {
        await database.query(`DROP TRIGGER reject_delete ON "${schema}".blogs`);
        await database.query(`DROP FUNCTION "${schema}".reject_delete()`);
      }
    });

    it('creates the table with the incremental migration and preserves notifications on rerun', async () => {
      const runner = database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SET LOCAL search_path TO "${schema}", public`);
        await runner.query('DROP TABLE notifications');
        const migration = new AddNotifications1792570000000();
        await migration.up(runner);
        await runner.query(
          `INSERT INTO notifications (user_id, type, blog_id, blog_title, message)
        VALUES ($1, 'post_deleted', $2, 'Historical post', 'Deleted')`,
          [owner.id, randomUUID()],
        );
        await migration.up(runner);
        const rows = await runner.query('SELECT * FROM notifications');
        expect(rows).toHaveLength(1);
        expect(rows[0].read_at).toBeNull();
        const constraints =
          await runner.query(`SELECT conname FROM pg_constraint
        WHERE conrelid = 'notifications'::regclass AND contype = 'f'`);
        expect(
          constraints.map((row: { conname: string }) => row.conname),
        ).toEqual(['FK_notifications_user']);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  },
);
