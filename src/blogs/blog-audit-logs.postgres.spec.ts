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
import { UserStatus } from '../users/enums/user-status.enum.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogAuditLogEntity } from './entities/blog-audit-log.entity.js';
import { BlogsModule } from './blogs.module.js';
import { BlogImageStore } from './blog-image.store.js';
import { AddBlogAuditLogs1792490000000 } from '../database/migrations/1792490000000-AddBlogAuditLogs.js';

// All writes are confined to this newly created random schema. No Google or SMTP calls.
const schema = `audit_test_${randomUUID().replaceAll('-', '')}`;
let database: DataSource;
let adminDatabase: DataSource;
let app: INestApplication;
let owner: UserEntity;
let other: UserEntity;
let admin: UserEntity;
let category: CategoryEntity;
let secondCategory: CategoryEntity;
let tags: TagEntity[];
let ownerToken: string;
let otherToken: string;
let adminToken: string;
const imageUrl = `/images/${randomUUID()}.png`;
const images = { save: vi.fn().mockResolvedValue(imageUrl), discard: vi.fn() };
@Global()
@Module({
  providers: [{ provide: DataSource, useFactory: () => database }],
  exports: [DataSource],
})
class TestDatabaseModule {}

const list = (token = ownerToken, query = '') =>
  request(app.getHttpServer())
    .get(`/api/v1/me/blog-audit-logs${query}`)
    .set('Authorization', `Bearer ${token}`);
const detail = (id: string, token = ownerToken) =>
  request(app.getHttpServer())
    .get(`/api/v1/me/blog-audit-logs/${id}`)
    .set('Authorization', `Bearer ${token}`);
const edit = (id: string, body: object, token = ownerToken) =>
  request(app.getHttpServer())
    .patch(`/api/v1/blogs/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const remove = (id: string, token = ownerToken) =>
  request(app.getHttpServer())
    .delete(`/api/v1/blogs/${id}`)
    .set('Authorization', `Bearer ${token}`);
const moderate = (id: string, status: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/admin/blogs/${id}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status });
async function createPost() {
  const response = await request(app.getHttpServer())
    .post('/api/v1/blogs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      title: `Original ${randomUUID()}`,
      content: 'Original content',
      categoryId: category.id,
      tagIds: tags.map((tag) => tag.id),
    })
    .expect(201);
  return response.body;
}

// Real HTTP guards, services, SQL constraints, and transaction rollback are exercised.
describe.runIf(process.env.BLOGHUB_RUN_DB_TESTS === '1')(
  'Blog audit history PostgreSQL/HTTP',
  () => {
    beforeAll(async () => {
      dotenv.config({ quiet: true });
      vi.stubEnv('JWT_SECRET', 'audit-test-secret-at-least-32-bytes-long');
      vi.stubEnv('FRONTEND_ORIGINS', 'http://localhost:3000');
      const connection = {
        type: 'postgres' as const,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5433),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        installExtensions: false,
        connectTimeoutMS: 5000,
      };
      adminDatabase = await new DataSource(connection).initialize();
      await adminDatabase.query(`CREATE SCHEMA "${schema}"`);
      database = await new DataSource({
        ...connection,
        schema,
        entities: [...seedEntities, AuthAccountEntity, BlogAuditLogEntity],
        synchronize: true,
      }).initialize();
      const passwordHash = await bcrypt.hash('Password123!', 4);
      const createUser = (email: string, role = UserRole.AUTHOR) =>
        database.getRepository(UserEntity).save({
          email,
          displayName: email.split('@')[0],
          passwordHash,
          role,
          status: UserStatus.ACTIVE,
        });
      owner = await createUser('owner@example.com');
      other = await createUser('other@example.com');
      admin = await createUser('admin@example.com', UserRole.ADMIN);
      category = await database.getRepository(CategoryEntity).save({
        name: 'Dancing',
        normalizedName: 'dancing',
        slug: 'dancing',
        createdById: owner.id,
      });
      secondCategory = await database.getRepository(CategoryEntity).save({
        name: 'Music',
        normalizedName: 'music',
        slug: 'music',
        createdById: owner.id,
      });
      tags = await database.getRepository(TagEntity).save(
        ['Ballet', 'Beginner'].map((name) => ({
          name,
          normalizedName: name.toLowerCase(),
          slug: name.toLowerCase(),
          categoryId: category.id,
          createdById: owner.id,
        })),
      );
      const module = await Test.createTestingModule({
        imports: [TestDatabaseModule, BlogsModule],
      })
        .overrideProvider(BlogImageStore)
        .useValue(images)
        .compile();
      app = module.createNestApplication();
      app.useLogger(false);
      app.setGlobalPrefix('api/v1');
      await app.init();
      async function login(user: UserEntity) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', 'http://localhost:3000')
          .send({ email: user.email, password: 'Password123!' })
          .expect(200);
        return response.body.accessToken;
      }
      ownerToken = await login(owner);
      otherToken = await login(other);
      adminToken = await login(admin);
    }, 30000);
    beforeEach(async () => {
      await database.getRepository(BlogAuditLogEntity).clear();
      images.save.mockClear();
      images.discard.mockClear();
    });
    afterAll(async () => {
      await app?.close();
      if (database?.isInitialized) await database.destroy();
      if (adminDatabase?.isInitialized) {
        await adminDatabase.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await adminDatabase.destroy();
      }
      vi.unstubAllEnvs();
    });

    it('requires authentication, validates pagination/UUIDs, and returns empty history', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/me/blog-audit-logs')
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1/me/blog-audit-logs/${randomUUID()}`)
        .expect(401);
      expect((await list().expect(200)).body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
      for (const query of [
        '?page=0',
        '?limit=51',
        '?page=1.2',
        '?actorId=someone',
        '?page=1000001',
      ]) {
        await list(ownerToken, query).expect(400);
      }
      await detail('not-a-uuid').expect(400);
      await detail(randomUUID()).expect(404);
    });

    it('records exact old/new values and keeps large content out of list responses', async () => {
      const post = await createPost();
      expect((await list().expect(200)).body.total).toBe(0); // Creation is outside the agreed scope.
      await edit(post.id, {
        title: 'Updated title',
        content: 'Updated content',
      }).expect(200);
      const history = (await list().expect(200)).body;
      expect(history.total).toBe(1);
      expect(history.items[0]).toMatchObject({
        blogId: post.id,
        blogTitle: 'Updated title',
        actorId: owner.id,
        postAuthorId: owner.id,
        action: 'updated',
      });
      expect(history.items[0]).not.toHaveProperty('changes');
      expect(history.items[0]).not.toHaveProperty('snapshot');
      const log = (await detail(history.items[0].id).expect(200)).body;
      expect(log.changes).toEqual({
        title: { old: post.title, new: 'Updated title' },
        content: { old: 'Original content', new: 'Updated content' },
      });
      expect(log.snapshot).toBeNull();
      expect(JSON.stringify(log)).not.toContain('passwordHash');
      expect(JSON.stringify(log)).not.toContain(owner.email);
    });

    it('skips no-op edits and tag reordering, but tracks tag/category and image changes', async () => {
      const post = await createPost();
      await edit(post.id, {
        title: post.title,
        tagIds: tags.map((tag) => tag.id).reverse(),
      }).expect(200);
      expect((await list().expect(200)).body.total).toBe(0);
      await edit(post.id, { categoryId: secondCategory.id }).expect(200);
      const log = (
        await detail((await list().expect(200)).body.items[0].id).expect(200)
      ).body;
      expect(log.changes.category).toMatchObject({
        old: { id: category.id },
        new: { id: secondCategory.id },
      });
      expect(log.changes.tags.old).toHaveLength(2);
      expect(log.changes.tags.new).toEqual([]);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${post.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', Buffer.from('mock-image'), {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .expect(200);
      const imageLog = (
        await detail((await list().expect(200)).body.items[0].id).expect(200)
      ).body;
      expect(imageLog.changes.coverImageUrl).toEqual({
        old: null,
        new: imageUrl,
      });
      await edit(post.id, { coverImageUrl: null }).expect(200);
    });

    it('records owner publishing plus admin moderation and isolates each actor history', async () => {
      const post = await createPost();
      await edit(post.id, {
        status: 'published',
        title: 'Published title',
      }).expect(200);
      const first = (
        await detail((await list().expect(200)).body.items[0].id).expect(200)
      ).body;
      expect(first.action).toBe('published');
      expect(first.changes.status).toEqual({ old: 'draft', new: 'published' });
      expect(first.changes.title.new).toBe('Published title');
      const unpublished = await moderate(post.id, 'draft').expect(200);
      expect(unpublished.body.publicationBlocked).toBe(true);
      await edit(post.id, { status: 'published' }).expect(403);
      await moderate(post.id, 'draft').expect(200); // Same blocked draft does not add another record.
      const adminHistory = (await list(adminToken).expect(200)).body;
      expect(adminHistory.total).toBe(1);
      const adminLog = (
        await detail(adminHistory.items[0].id, adminToken).expect(200)
      ).body;
      expect(adminLog).toMatchObject({
        actorId: admin.id,
        postAuthorId: owner.id,
        action: 'unpublished',
      });
      expect(adminLog.changes.publicationBlocked).toEqual({
        old: false,
        new: true,
      });
      await detail(adminLog.id).expect(404);
      await detail(first.id, adminToken).expect(404); // Admin has no global history access.
      expect((await list().expect(200)).body.total).toBe(1);
      await moderate(post.id, 'published').expect(200);
      expect((await list(adminToken).expect(200)).body.total).toBe(2);
      const republish = (
        await detail(
          (await list(adminToken).expect(200)).body.items[0].id,
          adminToken,
        ).expect(200)
      ).body;
      expect(republish.action).toBe('published');
      expect(republish.changes.publicationBlocked).toEqual({
        old: true,
        new: false,
      });
      expect(republish.changes).not.toHaveProperty('publishedAt');
    });

    it('logs blocking a never-published draft as an unpublish action', async () => {
      const post = await createPost();
      await moderate(post.id, 'draft').expect(200);
      const log = (
        await detail(
          (await list(adminToken).expect(200)).body.items[0].id,
          adminToken,
        ).expect(200)
      ).body;
      expect(log.action).toBe('unpublished');
      expect(log.changes).toEqual({
        publicationBlocked: { old: false, new: true },
      });
    });

    it('keeps edit history and a complete deletion snapshot after the post is gone', async () => {
      const post = await createPost();
      await edit(post.id, { content: 'Final content' }).expect(200);
      await remove(post.id).expect(204);
      expect(
        await database.getRepository(BlogEntity).existsBy({ id: post.id }),
      ).toBe(false);
      const history = (await list().expect(200)).body;
      expect(history.total).toBe(2);
      const deletion = history.items.find(
        (item: { action: string }) => item.action === 'deleted',
      );
      const log = (await detail(deletion.id).expect(200)).body;
      expect(log.changes).toEqual({});
      expect(log.snapshot).toMatchObject({
        id: post.id,
        authorId: owner.id,
        content: 'Final content',
        category: { id: category.id, name: 'Dancing' },
        slug: post.slug,
        status: 'draft',
      });
      expect(log.snapshot.tags).toHaveLength(2);
      expect(log.snapshot.createdAt).toBe(post.createdAt);
      await detail(log.id, otherToken).expect(404);
      await detail(log.id, adminToken).expect(404);
      expect((await list(otherToken).expect(200)).body.total).toBe(0);
    });

    it('records admin deletion as the admin action rather than the post author action', async () => {
      const post = await createPost();
      await remove(post.id, adminToken).expect(204);
      expect((await list().expect(200)).body.total).toBe(0);
      const history = (await list(adminToken).expect(200)).body;
      expect(history.items[0]).toMatchObject({
        action: 'deleted',
        actorId: admin.id,
        postAuthorId: owner.id,
      });
      expect(
        (await detail(history.items[0].id, adminToken).expect(200)).body
          .snapshot.id,
      ).toBe(post.id);
    });

    it('does not log forbidden/invalid edits and offers no history mutation endpoints', async () => {
      const post = await createPost();
      await edit(post.id, { title: 'Stolen edit' }, otherToken).expect(403);
      await remove(post.id, otherToken).expect(403);
      await edit(post.id, { categoryId: randomUUID() }).expect(404);
      await edit(post.id, { actorId: admin.id }).expect(400);
      expect((await list().expect(200)).body.total).toBe(0);
      for (const method of ['patch', 'delete'] as const) {
        await request(app.getHttpServer())
          [method](`/api/v1/me/blog-audit-logs/${randomUUID()}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(404);
      }
    });

    it('rolls back edits, moderation, and deletion if inserting the audit record fails', async () => {
      const post = await createPost();
      await database.query(`CREATE FUNCTION "${schema}".reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$`);
      await database.query(`CREATE TRIGGER reject_audit BEFORE INSERT ON "${schema}".blog_audit_logs
      FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_audit()`);
      try {
        await edit(post.id, { title: 'Must roll back' }).expect(500);
        expect(
          (
            await database
              .getRepository(BlogEntity)
              .findOneByOrFail({ id: post.id })
          ).title,
        ).toBe(post.title);
        await moderate(post.id, 'draft').expect(500);
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
        await request(app.getHttpServer())
          .patch(`/api/v1/blogs/${post.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .attach('image', Buffer.from('mock'), {
            filename: 'test.png',
            contentType: 'image/png',
          })
          .expect(500);
        expect(images.discard).toHaveBeenCalledWith(imageUrl);
        expect(
          (
            await database
              .getRepository(BlogEntity)
              .findOneByOrFail({ id: post.id })
          ).coverImageUrl,
        ).toBeNull();
        expect((await list().expect(200)).body.total).toBe(0);
      } finally {
        await database.query(
          `DROP TRIGGER reject_audit ON "${schema}".blog_audit_logs`,
        );
        await database.query(`DROP FUNCTION "${schema}".reject_audit()`);
      }
    });

    it('serializes concurrent edits so the second log starts from the first committed value', async () => {
      const post = await createPost();
      await Promise.all([
        edit(post.id, { title: 'Concurrent A' }).expect(200),
        edit(post.id, { title: 'Concurrent B' }).expect(200),
      ]);
      const summaries = (await list().expect(200)).body.items;
      const logs = await Promise.all(
        summaries.map(
          async (item: { id: string }) =>
            (await detail(item.id).expect(200)).body,
        ),
      );
      const first = logs.find((log) => log.changes.title.old === post.title);
      const second = logs.find((log) => log.id !== first.id);
      expect(second.changes.title.old).toBe(first.changes.title.new);
      expect(['Concurrent A', 'Concurrent B']).toContain(
        second.changes.title.new,
      );
    });

    it('paginates newest first and retains historical snapshots after taxonomy is deleted', async () => {
      const post = await createPost();
      await edit(post.id, { title: 'First edit' }).expect(200);
      await remove(post.id).expect(204);
      const firstPage = (await list(ownerToken, '?page=1&limit=1').expect(200))
        .body;
      expect(firstPage).toMatchObject({
        total: 2,
        totalPages: 2,
        page: 1,
        limit: 1,
      });
      expect(firstPage.items[0].action).toBe('deleted');
      const secondPage = (await list(ownerToken, '?page=2&limit=1').expect(200))
        .body;
      expect(secondPage.items[0].action).toBe('updated');
      expect(
        (await list(ownerToken, '?page=3&limit=1').expect(200)).body.items,
      ).toEqual([]);
      await database.getRepository(CategoryEntity).delete(category.id);
      const snapshot = (await detail(firstPage.items[0].id).expect(200)).body
        .snapshot;
      expect(snapshot.category.name).toBe('Dancing');
      expect(snapshot.tags).toHaveLength(2);
    });

    it('creates the audit table with the incremental migration and preserves existing logs on rerun', async () => {
      const runner = database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SET LOCAL search_path TO "${schema}", public`);
        await runner.query('DROP TABLE blog_audit_logs');
        const migration = new AddBlogAuditLogs1792490000000();
        await migration.up(runner);
        await runner.query(
          `INSERT INTO blog_audit_logs (blog_id, blog_title, actor_id, post_author_id, action, changes)
        VALUES ($1, 'Historical post', $2, $2, 'updated', '{}')`,
          [randomUUID(), owner.id],
        );
        await migration.up(runner);
        const rows = await runner.query('SELECT * FROM blog_audit_logs');
        expect(rows).toHaveLength(1);
        expect(rows[0].blog_title).toBe('Historical post');
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  },
);
