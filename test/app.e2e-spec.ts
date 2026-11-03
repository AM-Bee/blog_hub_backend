import 'reflect-metadata';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Response as HttpResponse } from 'supertest';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import migrationSource from '../src/database/data-source.js';
import { BlogImageStore } from '../src/blogs/blog-image.store.js';
import { PostSyncOperationEntity } from '../src/blogs/entities/post-sync-operation.entity.js';
import { CategoryEntity } from '../src/categories/entities/category.entity.js';
import { TagEntity } from '../src/tags/entities/tag.entity.js';
import { BlogTagEntity } from '../src/blogs/entities/blog-tag.entity.js';
import { BlogEntity } from '../src/blogs/entities/blog.entity.js';
import { BlogStatus } from '../src/blogs/enums/blog-status.enum.js';
import { UserStatus } from '../src/users/enums/user-status.enum.js';
import { seedFaqs, initialFaqs } from '../src/faq/seed-faqs.js';
import { FaqEntity } from '../src/faq/entities/faq.entity.js';
import { FaqCategoryEntity } from '../src/faq/entities/faq-category.entity.js';
import { ReactionEntity } from '../src/reactions/entities/reaction.entity.js';
import { BlogCommentEntity } from '../src/comments/entities/blog-comment.entity.js';
import { AppModule } from '../src/app.module.js';
import { seedEntities } from '../src/seed.js';
import { UserEntity } from '../src/users/entities/user.entity.js';
import { UserRole } from '../src/users/enums/user-role.enum.js';
import { AuthAccountEntity } from '../src/auth/entities/auth-account.entity.js';
import { BlogAuditLogEntity } from '../src/blogs/entities/blog-audit-log.entity.js';
import { NotificationEntity } from '../src/notifications/entities/notification.entity.js';
import { ConversationEntity } from '../src/chat/entities/conversation.entity.js';
import { MessageEntity } from '../src/chat/entities/message.entity.js';
import type { ChatAck } from '../src/chat/interface/chat-ack.interface.js';
import type {
  MessageDeleted,
  MessageSent,
} from '../src/chat/interface/chat-event.interface.js';

// Full AppModule wiring, but every write is confined to this disposable schema.
const schema = `acceptance_test_${randomUUID().replaceAll('-', '')}`;
const origin = 'http://localhost:3000';
let connection: DataSource;
let database: DataSource;
let app: NestExpressApplication;
let alice: UserEntity;
let bob: UserEntity;
let aliceToken: string;
let bobToken: string;
let adminToken: string;
const sockets: Socket[] = [];

const login = (email: string, password = 'Password123!') =>
  request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .send({ email, password });
async function connect(token: string): Promise<Socket> {
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const socket = io(`http://127.0.0.1:${port}/chat`, {
    transports: ['websocket'],
    auth: { accessToken: token },
    extraHeaders: { Origin: origin },
    autoConnect: false,
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    socket.connect();
  });
}
function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Missing event ${name}`)),
      10000,
    );
    socket.once(name, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe.runIf(process.env.BLOGHUB_RUN_DB_TESTS === '1')(
  'Full backend acceptance',
  () => {
    beforeAll(async () => {
      dotenv.config({ quiet: true });
      vi.stubEnv(
        'JWT_SECRET',
        'acceptance-test-secret-at-least-thirty-two-bytes',
      );
      vi.stubEnv('FRONTEND_ORIGINS', origin);
      const options = {
        type: 'postgres' as const,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5433),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl:
          process.env.DB_SSL === 'true'
            ? {
                ca: process.env.DB_SSL_CA_FILE
                  ? readFileSync(process.env.DB_SSL_CA_FILE, 'utf8')
                  : undefined,
              }
            : false,
        uuidExtension: 'pgcrypto' as const,
        installExtensions: false,
        connectTimeoutMS: 5000,
      };
      connection = await new DataSource(options).initialize();
      await connection.query(`CREATE SCHEMA "${schema}"`);
      database = await new DataSource({
        ...options,
        schema,
        synchronize: false,
        migrations: migrationSource.options.migrations,
        extra: { options: `-c search_path=${schema},public` },
        entities: [
          ...seedEntities,
          PostSyncOperationEntity,
          AuthAccountEntity,
          BlogAuditLogEntity,
          NotificationEntity,
          BlogCommentEntity,
          ReactionEntity,
          FaqEntity,
          FaqCategoryEntity,
          ConversationEntity,
          MessageEntity,
        ],
      }).initialize();
      await database.runMigrations();
      // Every application query uses this disposable schema, including sync receipts.
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DataSource)
        .useValue(database)
        .compile();
      app = module.createNestApplication<NestExpressApplication>();
      app.useLogger(false);
      app.setGlobalPrefix('api/v1');
      app.useBodyParser('json', { limit: '1mb' });
      app.use(cookieParser());
      await app.listen(0, '127.0.0.1');
      for (const name of ['alice', 'bob']) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            displayName: name,
            email: `${name}@acceptance.example`,
            password: 'Password123!',
          })
          .expect(201);
      }
      alice = await database
        .getRepository(UserEntity)
        .findOneByOrFail({ email: 'alice@acceptance.example' });
      bob = await database
        .getRepository(UserEntity)
        .findOneByOrFail({ email: 'bob@acceptance.example' });
      await database.getRepository(UserEntity).save({
        displayName: 'Admin',
        email: 'admin@acceptance.example',
        role: UserRole.ADMIN,
        passwordHash: await bcrypt.hash('Password123!', 4),
      });
      aliceToken = (await login(alice.email).expect(200)).body.accessToken;
      bobToken = (await login(bob.email).expect(200)).body.accessToken;
      adminToken = (await login('admin@acceptance.example').expect(200)).body
        .accessToken;
    }, 120000);
    afterAll(async () => {
      sockets.forEach((socket) => socket.disconnect());
      await app?.close();
      if (database?.isInitialized) await database.destroy();
      if (connection?.isInitialized) {
        await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await connection.destroy();
      }
      vi.unstubAllEnvs();
    });

    it('serves the general API through the complete application module', async () => {
      await request(app.getHttpServer())
        .get('/api/v1')
        .expect(200)
        .expect('Hello World!');
    });

    it('preserves profiles, taxonomy, blogs, moderation, audit, notifications, search, and admin user management', async () => {
      const profile = await request(app.getHttpServer())
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ displayName: 'Regression Writer' })
        .expect(200);
      expect(profile.body.displayName).toBe('Regression Writer');
      const category = (
        await request(app.getHttpServer())
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${aliceToken}`)
          .send({ name: 'Regression Dancing' })
          .expect(201)
      ).body;
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ name: ' regression DANCING ' })
        .expect(409);
      const tag = (
        await request(app.getHttpServer())
          .post('/api/v1/tags')
          .set('Authorization', `Bearer ${aliceToken}`)
          .send({ categoryId: category.id, name: 'Ballet' })
          .expect(201)
      ).body;
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ name: 'Other edit' })
        .expect(403);
      const blog = (
        await request(app.getHttpServer())
          .post('/api/v1/blogs')
          .set('Authorization', `Bearer ${aliceToken}`)
          .send({
            title: 'Regression post',
            content: 'Published content',
            categoryId: category.id,
            tagIds: [tag.id],
            status: 'published',
          })
          .expect(201)
      ).body;
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Admin cannot rewrite author content' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ title: 'Regression post updated' })
        .expect(200);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/blogs')
            .query({ author: 'regression writer', tag: tag.slug })
            .expect(200)
        ).body.total,
      ).toBe(1);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/blogs/${blog.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'draft' })
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/blogs/${blog.slug}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ status: 'published' })
        .expect(403);
      const notifications = (
        await request(app.getHttpServer())
          .get('/api/v1/me/notifications')
          .set('Authorization', `Bearer ${aliceToken}`)
          .expect(200)
      ).body;
      expect(notifications.items[0].type).toBe('post_unpublished');
      const audit = (
        await request(app.getHttpServer())
          .get('/api/v1/me/blog-audit-logs')
          .set('Authorization', `Bearer ${aliceToken}`)
          .expect(200)
      ).body;
      expect(audit.total).toBeGreaterThan(0);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/blogs/${blog.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'published' })
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
      const preserved = (
        await request(app.getHttpServer())
          .get(`/api/v1/blogs/${blog.slug}`)
          .expect(200)
      ).body;
      expect(preserved.categoryName).toBe('Uncategorized');
      expect(preserved.tags).toEqual([]);
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${bob.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'disabled' })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${bob.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);
    });

    it('supports published comments, one reply level, ownership, moderation, and cascade deletion', async () => {
      const token = (await login(bob.email).expect(200)).body.accessToken;
      const blogs = database.getRepository(BlogEntity);
      const blog = await blogs.save({
        authorId: alice.id,
        title: 'Comment test',
        slug: `comments-${randomUUID()}`,
        content: 'Test',
        status: BlogStatus.PUBLISHED,
      });
      const path = `/api/v1/blogs/${blog.id}/comments`;
      const create = (body: object, accessToken = aliceToken) =>
        request(app.getHttpServer())
          .post(path)
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body);
      const edit = (id: string, accessToken = aliceToken) =>
        request(app.getHttpServer())
          .patch(`/api/v1/comments/${id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ content: 'Edited' });
      const remove = (id: string, accessToken = aliceToken) =>
        request(app.getHttpServer())
          .delete(`/api/v1/comments/${id}`)
          .set('Authorization', `Bearer ${accessToken}`);
      const reply = (id: string, accessToken = token) =>
        request(app.getHttpServer())
          .post(`/api/v1/comments/${id}/replies`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ content: 'Reply' });
      const listReplies = (id: string) =>
        request(app.getHttpServer()).get(`/api/v1/comments/${id}/replies`);

      await request(app.getHttpServer())
        .post(path)
        .send({ content: 'Anonymous' })
        .expect(401);
      for (const body of [
        { content: ' ' },
        { content: 'a'.repeat(2001) },
        { content: 'Spoofed', userId: bob.id },
      ])
        await create(body).expect(400);
      const root = (await create({ content: '  First comment  ' }).expect(201))
        .body;
      expect(root).toMatchObject({
        content: 'First comment',
        blogId: blog.id,
        parentId: null,
        author: { id: alice.id },
      });
      expect(Object.keys(root.author).sort()).toEqual(['displayName', 'id']);
      const child = (await reply(root.id).expect(201)).body;
      expect(child.parentId).toBe(root.id);
      expect((await listReplies(root.id).expect(200)).body.total).toBe(1);
      await reply(child.id).expect(400);
      await listReplies(child.id).expect(400);
      await create({ content: 'Second comment' }, token).expect(201);
      const page = (
        await request(app.getHttpServer())
          .get(path)
          .query({ page: 1, limit: 1 })
          .expect(200)
      ).body;
      expect(page).toMatchObject({ total: 2, totalPages: 2 });
      expect(page.items[0].id).toBe(root.id);
      await request(app.getHttpServer())
        .get(path)
        .query({ limit: 51 })
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/v1/blogs/not-a-uuid/comments')
        .expect(400);
      await edit(root.id, token).expect(403);
      await edit(root.id, adminToken).expect(403);
      await remove(root.id, token).expect(403);
      expect((await edit(root.id).expect(200)).body.content).toBe('Edited');
      await edit(child.id, token).expect(200);
      await remove(child.id, token).expect(204);
      expect((await listReplies(root.id).expect(200)).body.total).toBe(0);
      await reply(root.id).expect(201);

      await blogs.update(blog.id, { status: BlogStatus.DRAFT });
      await request(app.getHttpServer()).get(path).expect(404);
      await listReplies(root.id).expect(404);
      await create({ content: 'Hidden' }).expect(404);
      await reply(root.id).expect(404);
      await edit(root.id).expect(404);
      await remove(root.id, adminToken).expect(404);
      await blogs.update(blog.id, { status: BlogStatus.PUBLISHED });
      await remove(root.id, adminToken).expect(204);
      expect(
        await database
          .getRepository(BlogCommentEntity)
          .countBy({ parentId: root.id }),
      ).toBe(0);
      await reply(root.id).expect(404);
      await remove(randomUUID()).expect(404);
      await create({ content: 'Last comment' }).expect(201);
      await blogs.delete(blog.id);
      expect(
        await database
          .getRepository(BlogCommentEntity)
          .countBy({ blogId: blog.id }),
      ).toBe(0);
      await request(app.getHttpServer()).get(path).expect(404);
    }, 120000);

    it('counts replies and toggles blog, comment, and reply reactions with private user state and cascading cleanup', async () => {
      const token = (await login(bob.email).expect(200)).body.accessToken;
      const blogs = database.getRepository(BlogEntity);
      const comments = database.getRepository(BlogCommentEntity);
      const reactions = database.getRepository(ReactionEntity);
      const blog = await blogs.save({
        authorId: alice.id,
        title: 'Reactions test',
        slug: `reactions-${randomUUID()}`,
        content: 'Test',
        status: BlogStatus.PUBLISHED,
      });
      const root = await comments.save({
        blogId: blog.id,
        userId: alice.id,
        parentId: null,
        content: 'Comment',
      });
      const child = await comments.save({
        blogId: blog.id,
        userId: bob.id,
        parentId: root.id,
        content: 'Reply',
      });
      const endpoints = [
        `/api/v1/blogs/${blog.id}/reactions`,
        `/api/v1/comments/${root.id}/reactions`,
        `/api/v1/comments/${child.id}/reactions`,
      ];
      const toggle = (path: string, type: string, accessToken = aliceToken) =>
        request(app.getHttpServer())
          .post(path)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ type });
      const summary = (path: string, accessToken?: string) => {
        const call = request(app.getHttpServer()).get(path);
        return accessToken
          ? call.set('Authorization', `Bearer ${accessToken}`)
          : call;
      };
      for (const path of endpoints) {
        expect((await summary(path).expect(200)).body).toEqual({
          likeCount: 0,
          dislikeCount: 0,
          myReaction: null,
        });
        expect((await toggle(path, 'like').expect(200)).body).toEqual({
          likeCount: 1,
          dislikeCount: 0,
          myReaction: 'like',
        });
        await toggle(path, 'like', token).expect(200);
        expect((await toggle(path, 'dislike').expect(200)).body).toEqual({
          likeCount: 1,
          dislikeCount: 1,
          myReaction: 'dislike',
        });
        expect((await summary(path, token).expect(200)).body.myReaction).toBe(
          'like',
        );
        expect((await summary(path).expect(200)).body).toEqual({
          likeCount: 1,
          dislikeCount: 1,
          myReaction: null,
        });
        expect((await toggle(path, 'dislike').expect(200)).body).toEqual({
          likeCount: 1,
          dislikeCount: 0,
          myReaction: null,
        });
      }
      const listPath = `/api/v1/blogs/${blog.id}/comments`;
      expect(
        (await request(app.getHttpServer()).get(listPath).expect(200)).body
          .items[0],
      ).toMatchObject({
        id: root.id,
        replyCount: 1,
        likeCount: 1,
        dislikeCount: 0,
      });
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/comments/${root.id}/replies`)
            .expect(200)
        ).body.items[0],
      ).toMatchObject({ id: child.id, replyCount: 0, likeCount: 1 });
      expect(
        (
          await request(app.getHttpServer())
            .patch(`/api/v1/comments/${root.id}`)
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({ content: 'Edited' })
            .expect(200)
        ).body,
      ).toMatchObject({ replyCount: 1, likeCount: 1 });

      const path = endpoints[0];
      await request(app.getHttpServer())
        .post(path)
        .send({ type: 'like' })
        .expect(401);
      for (const body of [
        {},
        { type: 'love' },
        { type: 'like', userId: bob.id },
      ]) {
        await request(app.getHttpServer())
          .post(path)
          .set('Authorization', `Bearer ${aliceToken}`)
          .send(body)
          .expect(400);
      }
      await summary(path, 'invalid').expect(401);
      await toggle('/api/v1/blogs/not-a-uuid/reactions', 'like').expect(400);
      await toggle(`/api/v1/comments/${randomUUID()}/reactions`, 'like').expect(
        404,
      );
      await summary(`/api/v1/blogs/${randomUUID()}/reactions`).expect(404);
      await database
        .getRepository(UserEntity)
        .update(bob.id, { status: UserStatus.DISABLED });
      await summary(path, token).expect(401);
      await toggle(path, 'dislike', token).expect(401);
      await database
        .getRepository(UserEntity)
        .update(bob.id, { status: UserStatus.ACTIVE });

      // Two real concurrent toggle requests must not create duplicate rows.
      const concurrent = await Promise.all([
        toggle(path, 'like'),
        toggle(path, 'like'),
      ]);
      expect(concurrent.map((result) => result.status)).toEqual([200, 200]);
      expect(
        await reactions.countBy({ blogId: blog.id, userId: alice.id }),
      ).toBe(0);
      await expect(
        reactions.insert({
          blogId: blog.id,
          userId: bob.id,
          type: 'like' as ReactionEntity['type'],
        }),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
      await expect(
        reactions.insert({
          blogId: blog.id,
          commentId: root.id,
          userId: alice.id,
          type: 'like' as ReactionEntity['type'],
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
      await expect(
        reactions.insert({
          userId: alice.id,
          type: 'like' as ReactionEntity['type'],
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
      await expect(
        reactions.insert({
          blogId: blog.id,
          userId: alice.id,
          type: 'love' as ReactionEntity['type'],
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
      await expect(
        reactions.insert({
          commentId: root.id,
          userId: bob.id,
          type: 'like' as ReactionEntity['type'],
        }),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });

      await blogs.update(blog.id, { status: BlogStatus.DRAFT });
      for (const endpoint of endpoints) {
        await summary(endpoint).expect(404);
        await toggle(endpoint, 'like').expect(404);
      }
      await blogs.update(blog.id, { status: BlogStatus.PUBLISHED });
      await request(app.getHttpServer())
        .delete(`/api/v1/comments/${child.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      expect(await reactions.countBy({ commentId: child.id })).toBe(0);
      expect(
        (await request(app.getHttpServer()).get(listPath).expect(200)).body
          .items[0].replyCount,
      ).toBe(0);
      const newReply = await comments.save({
        blogId: blog.id,
        userId: bob.id,
        parentId: root.id,
        content: 'Another reply',
      });
      await toggle(`/api/v1/comments/${newReply.id}/reactions`, 'like').expect(
        200,
      );
      await request(app.getHttpServer())
        .delete(`/api/v1/comments/${root.id}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(204);
      expect(await reactions.countBy({ commentId: root.id })).toBe(0);
      expect(await reactions.countBy({ commentId: newReply.id })).toBe(0);
      expect(await reactions.countBy({ blogId: blog.id })).toBe(1);
      await blogs.delete(blog.id);
      expect(await reactions.countBy({ blogId: blog.id })).toBe(0);
    }, 180000);

    it('manages FAQ content only as admin, filters inactive answers, preserves PATCH fields, paginates, and enforces category relationships', async () => {
      const admin = (
        method: 'get' | 'post' | 'patch' | 'delete',
        path: string,
      ) =>
        request(app.getHttpServer())
          [method](`/api/v1${path}`)
          .set('Authorization', `Bearer ${adminToken}`);
      await request(app.getHttpServer()).get('/api/v1/admin/faqs').expect(401);
      for (const [method, path] of [
        ['get', '/admin/faqs'],
        ['post', '/admin/faqs'],
        ['patch', `/admin/faqs/${randomUUID()}`],
        ['delete', `/admin/faqs/${randomUUID()}`],
        ['get', '/admin/faq-categories'],
        ['post', '/admin/faq-categories'],
        ['patch', `/admin/faq-categories/${randomUUID()}`],
        ['delete', `/admin/faq-categories/${randomUUID()}`],
      ] as const) {
        await request(app.getHttpServer())
          [method](`/api/v1${path}`)
          .set('Authorization', `Bearer ${aliceToken}`)
          .expect(403);
      }
      const category = (
        await admin('post', '/admin/faq-categories')
          .send({ name: 'FAQ test', slug: 'faq-test' })
          .expect(201)
      ).body;
      const empty = (
        await admin('post', '/admin/faq-categories')
          .send({ name: 'Empty FAQ category', slug: 'empty-faq' })
          .expect(201)
      ).body;
      await admin('post', '/admin/faq-categories')
        .send({ name: 'FAQ test', slug: 'another-slug' })
        .expect(409);
      await admin('post', '/admin/faq-categories')
        .send({ name: 'Another name', slug: 'faq-test' })
        .expect(409);
      const active = (
        await admin('post', '/admin/faqs')
          .send({
            categoryId: category.id,
            question: 'How do I create a blog?',
            answer: 'Verified test answer',
            alternativeQuestions: ['How do I write a post?'],
            keywords: ['create blog'],
            displayOrder: 5,
          })
          .expect(201)
      ).body;
      const hidden = (
        await admin('post', '/admin/faqs')
          .send({
            categoryId: category.id,
            question: 'What is the private unicorn feature?',
            answer: 'Hidden test answer',
            isActive: false,
            keywords: ['unicorn'],
            displayOrder: 42,
          })
          .expect(201)
      ).body;
      const ask = (question: string) =>
        request(app.getHttpServer()).post('/api/v1/faq/ask').send({ question });
      expect(
        (await ask('How do I WRITE a post!!!').expect(200)).body,
      ).toMatchObject({
        found: true,
        answer: 'Verified test answer',
        matchedQuestion: active.question,
        category: 'FAQ test',
        suggestions: [],
      });
      await request(app.getHttpServer())
        .get(`/api/v1/faq/${hidden.id}`)
        .expect(404);
      expect((await ask(hidden.question).expect(200)).body.found).toBe(false);
      const publicFaq = (
        await request(app.getHttpServer())
          .get(`/api/v1/faq/${active.id}`)
          .expect(200)
      ).body;
      expect(Object.keys(publicFaq).sort()).toEqual([
        'answer',
        'category',
        'id',
        'question',
      ]);
      const suggestions = (
        await request(app.getHttpServer())
          .get('/api/v1/faq/suggestions')
          .query({ categoryId: category.id })
          .expect(200)
      ).body;
      expect(suggestions.map((item: { id: string }) => item.id)).toEqual([
        active.id,
      ]);
      const publicCategories = (
        await request(app.getHttpServer())
          .get('/api/v1/faq/categories')
          .expect(200)
      ).body;
      expect(publicCategories.map((item: { id: string }) => item.id)).toContain(
        category.id,
      );
      expect(
        publicCategories.map((item: { id: string }) => item.id),
      ).not.toContain(empty.id);
      expect(
        (await admin('get', '/admin/faq-categories').expect(200)).body,
      ).toHaveLength(2);
      const page = (
        await admin('get', '/admin/faqs')
          .query({ categoryId: category.id, limit: 1, page: 2 })
          .expect(200)
      ).body;
      expect(page).toMatchObject({ total: 2, totalPages: 2, page: 2 });
      expect(page.items[0].id).toBe(hidden.id);
      expect(
        (await admin('get', `/admin/faqs/${hidden.id}`).expect(200)).body
          .isActive,
      ).toBe(false);
      const edited = (
        await admin('patch', `/admin/faqs/${hidden.id}`)
          .send({ answer: 'Updated hidden answer' })
          .expect(200)
      ).body;
      expect(edited).toMatchObject({
        isActive: false,
        keywords: ['unicorn'],
        displayOrder: 42,
      });
      expect(
        (
          await admin('get', '/admin/faqs')
            .query({ isActive: false })
            .expect(200)
        ).body.total,
      ).toBe(1);
      for (const body of [
        {},
        { isActive: null },
        { keywords: null },
        { answer: 'x', unexpected: true },
      ])
        await admin('patch', `/admin/faqs/${active.id}`).send(body).expect(400);
      await admin('post', '/admin/faqs')
        .send({
          categoryId: randomUUID(),
          question: 'Missing category',
          answer: 'No',
        })
        .expect(409);
      await admin('delete', `/admin/faq-categories/${category.id}`).expect(409);
      await admin('patch', `/admin/faq-categories/${category.id}`)
        .send({ name: 'Renamed FAQ category' })
        .expect(200);
      expect((await ask(active.question).expect(200)).body.category).toBe(
        'Renamed FAQ category',
      );
      await admin('patch', `/admin/faqs/${active.id}`)
        .send({ isActive: false })
        .expect(200);
      expect((await ask(active.question).expect(200)).body).toMatchObject({
        found: false,
        matchedQuestion: null,
        category: null,
        suggestions: [],
      });
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/faq/categories')
            .expect(200)
        ).body,
      ).toEqual([]);
      await request(app.getHttpServer())
        .post('/api/v1/faq/ask')
        .send({ question: ' ' })
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/v1/faq/suggestions')
        .query({ limit: 11 })
        .expect(400);
      await admin('get', '/admin/faqs')
        .query({ isActive: 'unknown' })
        .expect(400);
      await admin('get', '/admin/faqs').query({ limit: 51 }).expect(400);
      await request(app.getHttpServer())
        .get('/api/v1/faq/not-a-uuid')
        .expect(400);
      await admin('delete', `/admin/faqs/${active.id}`).expect(204);
      await admin('delete', `/admin/faqs/${hidden.id}`).expect(204);
      await admin('delete', `/admin/faqs/${hidden.id}`).expect(404);
      await admin('delete', `/admin/faq-categories/${category.id}`).expect(204);
      await admin('delete', `/admin/faq-categories/${empty.id}`).expect(204);
      await admin('get', `/admin/faqs/${randomUUID()}`).expect(404);
    }, 180000);

    it('seeds FAQ data idempotently without overwriting admin edits and rate limits public questions', async () => {
      await database.transaction(seedFaqs);
      const repository = database.getRepository(FaqEntity);
      const first = await repository.findOneByOrFail({
        question: initialFaqs[0].question,
      });
      await repository.update(first.id, {
        answer: 'Admin customized answer',
        isActive: false,
      });
      await database.transaction(seedFaqs);
      expect(await repository.count()).toBe(initialFaqs.length);
      expect(await database.getRepository(FaqCategoryEntity).count()).toBe(5);
      expect(await repository.findOneByOrFail({ id: first.id })).toMatchObject({
        answer: 'Admin customized answer',
        isActive: false,
      });
      const ask = () =>
        request(app.getHttpServer())
          .post('/api/v1/faq/ask')
          .send({ question: 'How do I log in?' });
      // Earlier asks may share this window; it must reject by the 21st attempt.
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 21; attempt++) {
        const response = await ask();
        statuses.push(response.status);
        if (response.status === 429) break;
        expect(response.body).toMatchObject({
          found: true,
          matchedQuestion: initialFaqs[1].question,
        });
      }
      expect(statuses).toContain(429);
    }, 180000);

    it('syncs a full own-post snapshot, stable IDs, optimistic writes, and scoped receipts using the mobile contract', async () => {
      const path = '/api/v1/me/blog-sync';
      const category = await database.getRepository(CategoryEntity).save({
        name: 'Sync category',
        normalizedName: 'sync category',
        slug: `sync-${randomUUID()}`,
        createdById: alice.id,
      });
      const tags = await database.getRepository(TagEntity).save(
        ['One', 'Two'].map((name) => ({
          name,
          normalizedName: name.toLowerCase(),
          slug: `tag-${randomUUID()}`,
          categoryId: category.id,
          createdById: alice.id,
        })),
      );
      const input = {
        operationId: randomUUID(),
        entityId: randomUUID(),
        type: 'CREATE',
        input: {
          title: 'Mobile story',
          content: 'က'.repeat(100000),
          categoryId: category.id,
          tagIds: tags.map((tag) => tag.id),
        },
      };
      const apply = (body: object, token = aliceToken) =>
        request(app.getHttpServer())
          .post(path)
          .set('Authorization', `Bearer ${token}`)
          .send(body);
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer()).post(path).send(input).expect(401);
      const created = (await apply(input).expect(200)).body;
      expect(created.blog).toMatchObject({
        id: input.entityId,
        title: 'Mobile story',
        author: { id: alice.id },
        status: 'draft',
      });
      expect(created.blog.content).toHaveLength(100000);
      expect(created.blog.tags).toHaveLength(2);
      expect(created.blog.version).toBeGreaterThan(1);
      expect((await apply(input).expect(200)).body).toEqual(created);
      await apply({
        ...input,
        input: { ...input.input, title: 'Changed reuse' },
      }).expect(409);
      await apply({ ...input, operationId: randomUUID() }).expect(409);
      const update = {
        operationId: randomUUID(),
        entityId: input.entityId,
        type: 'UPDATE',
        baseVersion: created.blog.version,
        input: { title: 'Mobile edited' },
      };
      const edited = (await apply(update).expect(200)).body.blog;
      expect(edited.version).toBeGreaterThan(created.blog.version);
      expect(edited.slug).toBe(created.blog.slug);
      expect((await apply(update).expect(200)).body.blog).toEqual(edited);
      await apply({ ...update, operationId: randomUUID() }).expect(409);
      await apply({
        ...update,
        operationId: randomUUID(),
        baseVersion: undefined,
      }).expect(400);
      await apply(
        { ...update, operationId: randomUUID(), baseVersion: edited.version },
        bobToken,
      ).expect(403);
      await apply(
        { ...update, operationId: randomUUID(), baseVersion: edited.version },
        adminToken,
      ).expect(403);
      // Operation UUIDs are private per user rather than globally unique.
      const other = (
        await apply({ ...input, entityId: randomUUID() }, bobToken).expect(200)
      ).body.blog;
      expect(other.author.id).toBe(bob.id);
      const blogs = database.getRepository(BlogEntity);
      await blogs.insert(
        Array.from({ length: 21 }, (_, index) => ({
          authorId: alice.id,
          categoryId: category.id,
          title: `Page ${index}`,
          slug: `page-${randomUUID()}`,
          content: 'Full body',
          status: BlogStatus.DRAFT,
        })),
      );
      const expected = (
        await blogs.find({
          where: { authorId: alice.id },
          order: { id: 'ASC' },
        })
      ).map((blog) => blog.id);
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const response: HttpResponse = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${aliceToken}`)
          .query(cursor ? { after: cursor } : {})
          .expect(200);
        expect(response.body.items.length).toBeLessThanOrEqual(20);
        for (const blog of response.body.items) {
          expect(blog.author.id).toBe(alice.id);
          expect(blog.content).toBeDefined();
          expect(blog.version).toBeGreaterThanOrEqual(1);
          ids.push(blog.id);
        }
        cursor = response.body.nextCursor;
      } while (cursor);
      expect(ids).toEqual(expected);
      expect(ids).not.toContain(other.id);
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${aliceToken}`)
        .query({ after: 'bad' })
        .expect(400);
      await apply({
        operationId: randomUUID(),
        entityId: randomUUID(),
        type: 'UPDATE',
        baseVersion: 1,
        input: { title: 'Deleted' },
      }).expect(404);
      const deletion = {
        operationId: randomUUID(),
        entityId: input.entityId,
        type: 'DELETE',
        baseVersion: edited.version,
      };
      expect((await apply(deletion).expect(200)).body).toEqual({
        deleted: true,
        id: input.entityId,
      });
      expect((await apply(deletion).expect(200)).body).toEqual({
        deleted: true,
        id: input.entityId,
      });
      await apply({ ...deletion, operationId: randomUUID() }).expect(200);
      await apply({
        ...update,
        operationId: randomUUID(),
        baseVersion: edited.version,
      }).expect(404);
    }, 180000);

    it('sync versions cover online edits, moderation, category deletion, and tag changes without breaking old clients', async () => {
      const category = await database.getRepository(CategoryEntity).save({
        name: 'Version category',
        normalizedName: 'version category',
        slug: `version-${randomUUID()}`,
        createdById: alice.id,
      });
      const tag = await database.getRepository(TagEntity).save({
        name: 'Version tag',
        normalizedName: 'version tag',
        slug: `version-tag-${randomUUID()}`,
        categoryId: category.id,
        createdById: alice.id,
      });
      const blogs = database.getRepository(BlogEntity);
      const blog = await blogs.save({
        authorId: alice.id,
        categoryId: category.id,
        title: 'Versioned',
        slug: `versioned-${randomUUID()}`,
        content: 'Content',
        status: BlogStatus.PUBLISHED,
      });
      const version = async () =>
        (await blogs.findOneByOrFail({ id: blog.id })).version;
      await database
        .getRepository(BlogTagEntity)
        .insert({ blogId: blog.id, tagId: tag.id });
      const tagged = await version();
      expect(tagged).toBeGreaterThan(blog.version);
      await database.getRepository(BlogTagEntity).delete({ blogId: blog.id });
      const untagged = await version();
      expect(untagged).toBeGreaterThan(tagged);
      const edit = (body: object, token = aliceToken) =>
        request(app.getHttpServer())
          .patch(`/api/v1/blogs/${blog.id}`)
          .set('Authorization', `Bearer ${token}`)
          .send(body);
      const updated = (
        await request(app.getHttpServer())
          .patch(`/api/v1/blogs/${blog.id}`)
          .set('Authorization', `Bearer ${aliceToken}`)
          .field('title', 'Online')
          .field('content', 'Online content')
          .field('categoryId', category.id)
          .field('tagIds', '[]')
          .field('coverImageUrl', 'null')
          .field('status', 'published')
          .field('expectedVersion', String(untagged))
          .expect(200)
      ).body;
      expect(updated.version).toBeGreaterThan(untagged);
      await edit({ title: 'Stale', expectedVersion: untagged }).expect(409);
      await edit(
        { title: 'Forbidden', expectedVersion: untagged },
        bobToken,
      ).expect(403);
      await request(app.getHttpServer())
        .delete(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .query({ version: untagged })
        .expect(409);
      await edit({ expectedVersion: updated.version }).expect(400);
      await edit({ expectedVersion: 0, title: 'Invalid' }).expect(400);
      const compatible = (await edit({ title: 'Old client' }).expect(200)).body;
      expect(compatible.version).toBeGreaterThan(updated.version);
      const moderated = (
        await request(app.getHttpServer())
          .patch(`/api/v1/admin/blogs/${blog.id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'draft' })
          .expect(200)
      ).body;
      expect(moderated.version).toBeGreaterThan(compatible.version);
      await request(app.getHttpServer())
        .post('/api/v1/me/blog-sync')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          operationId: randomUUID(),
          entityId: blog.id,
          type: 'UPDATE',
          baseVersion: moderated.version,
          input: { status: 'published' },
        })
        .expect(403);
      await database.getRepository(CategoryEntity).delete(category.id);
      expect(await version()).toBeGreaterThan(moderated.version);
      expect(
        (await blogs.findOneByOrFail({ id: blog.id })).categoryId,
      ).toBeNull();
      await request(app.getHttpServer())
        .delete(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(204);
    }, 120000);

    it('sync serializes concurrent image retries and rolls back post, audit, and receipt writes together', async () => {
      const category = await database.getRepository(CategoryEntity).save({
        name: 'Image sync category',
        normalizedName: 'image sync category',
        slug: `image-sync-${randomUUID()}`,
        createdById: alice.id,
      });
      const images = app.get(BlogImageStore);
      const uploaded: string[] = [];
      const save = vi.spyOn(images, 'save').mockImplementation(async () => {
        const url = `https://example.com/${randomUUID()}.png`;
        uploaded.push(url);
        return url;
      });
      const discard = vi.spyOn(images, 'discard').mockResolvedValue();
      const input = {
        operationId: randomUUID(),
        entityId: randomUUID(),
        type: 'CREATE',
        input: {
          title: 'Multipart mobile',
          content: 'က'.repeat(100000),
          categoryId: category.id,
        },
      };
      const send = (dto: {
        operationId: string;
        entityId: string;
        type: string;
        input: object;
        baseVersion?: number;
      }) => {
        const call = request(app.getHttpServer())
          .post('/api/v1/me/blog-sync')
          .set('Authorization', `Bearer ${aliceToken}`)
          .field('operationId', dto.operationId)
          .field('entityId', dto.entityId)
          .field('type', dto.type)
          .field('input', JSON.stringify(dto.input));
        if (dto.baseVersion !== undefined)
          call.field('baseVersion', String(dto.baseVersion));
        return call.attach(
          'image',
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          { filename: 'cover.png', contentType: 'image/png' },
        );
      };
      const failReceipt = {
        listenTo: () => PostSyncOperationEntity,
        beforeInsert: () => {
          throw new Error('Simulated receipt failure');
        },
      };
      try {
        const concurrent = await Promise.all([send(input), send(input)]);
        expect(concurrent.map((response) => response.status)).toEqual([
          200, 200,
        ]);
        expect(concurrent[0].body).toEqual(concurrent[1].body);
        expect(save).toHaveBeenCalledTimes(1);
        const created = concurrent[0].body.blog;
        expect(created.content).toHaveLength(100000);
        await send({ ...input, operationId: randomUUID() }).expect(409);
        expect(save).toHaveBeenCalledTimes(1);
        const update = {
          ...input,
          operationId: randomUUID(),
          type: 'UPDATE',
          baseVersion: created.version,
          input: { title: 'Rolled back edit' },
        };
        const auditBefore = await database
          .getRepository(BlogAuditLogEntity)
          .countBy({ blogId: input.entityId });
        database.subscribers.push(failReceipt);
        await send(update).expect(500);
        expect(
          await database
            .getRepository(BlogEntity)
            .findOneByOrFail({ id: input.entityId }),
        ).toMatchObject({
          title: 'Multipart mobile',
          version: created.version,
          coverImageUrl: uploaded[0],
        });
        expect(
          await database
            .getRepository(BlogAuditLogEntity)
            .countBy({ blogId: input.entityId }),
        ).toBe(auditBefore);
        expect(
          await database
            .getRepository(PostSyncOperationEntity)
            .countBy({ userId: alice.id, operationId: update.operationId }),
        ).toBe(0);
        expect(discard).toHaveBeenCalledTimes(1);
        expect(discard).toHaveBeenCalledWith(uploaded[1]);
        database.subscribers.splice(
          database.subscribers.indexOf(failReceipt),
          1,
        );
        const changed = (await send(update).expect(200)).body;
        expect(changed.blog.title).toBe('Rolled back edit');
        expect(changed.blog.version).toBeGreaterThan(created.version);
        expect((await send(update).expect(200)).body).toEqual(changed);
        expect(save).toHaveBeenCalledTimes(3);
        expect(
          await database
            .getRepository(BlogAuditLogEntity)
            .countBy({ blogId: input.entityId }),
        ).toBe(auditBefore + 1);
      } finally {
        const index = database.subscribers.indexOf(failReceipt);
        if (index >= 0) database.subscribers.splice(index, 1);
        save.mockRestore();
        discard.mockRestore();
      }
    }, 180000);

    it('promotes authors only through admin authorization and applies the role to existing tokens', async () => {
      const authorToken = (await login(bob.email).expect(200)).body.accessToken;
      const path = `/api/v1/admin/users/${bob.id}`;
      const promote = (token: string, body: object = { role: 'admin' }) =>
        request(app.getHttpServer())
          .patch(path)
          .set('Authorization', `Bearer ${token}`)
          .send(body);

      await request(app.getHttpServer())
        .patch(path)
        .send({ role: 'admin' })
        .expect(401);
      await promote(authorToken).expect(403);
      for (const body of [
        {},
        { role: 'author' },
        { role: 'owner' },
        { role: 'admin', status: 'active' },
      ]) {
        await promote(adminToken, body).expect(400);
      }
      await request(app.getHttpServer())
        .patch('/api/v1/admin/users/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${randomUUID()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' })
        .expect(404);

      await request(app.getHttpServer())
        .patch(`${path}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'disabled' })
        .expect(200);
      await promote(adminToken).expect(403);
      expect(
        (
          await database
            .getRepository(UserEntity)
            .findOneByOrFail({ id: bob.id })
        ).role,
      ).toBe(UserRole.AUTHOR);
      await request(app.getHttpServer())
        .patch(`${path}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);
      bobToken = (await login(bob.email).expect(200)).body.accessToken;
      const result = await promote(adminToken).expect(200);
      expect(result.body).toMatchObject({
        id: bob.id,
        role: 'admin',
        status: 'active',
        blogCount: 0,
      });
      for (const field of [
        'passwordHash',
        'passwordResetCodeHash',
        'passwordResetAttempts',
      ]) {
        expect(result.body).not.toHaveProperty(field);
      }
      expect(
        (
          await database
            .getRepository(UserEntity)
            .findOneByOrFail({ id: bob.id })
        ).role,
      ).toBe(UserRole.ADMIN);
      const repeated = await promote(adminToken).expect(200);
      expect(repeated.body.updatedAt).toBe(result.body.updatedAt);
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(200);
      const profile = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(200);
      expect(profile.body.role).toBe('admin');
    }, 60000);

    it('runs private chat through AppModule and invalidates existing socket credentials on password change', async () => {
      bobToken = (await login(bob.email).expect(200)).body.accessToken;
      const conversation = (
        await request(app.getHttpServer())
          .post('/api/v1/chat/conversations')
          .set('Authorization', `Bearer ${aliceToken}`)
          .send({ recipientId: bob.id })
          .expect(200)
      ).body;
      const sender = await connect(aliceToken);
      const receiver = await connect(bobToken);
      const received = event<MessageEntity>(receiver, 'message:new');
      const sending: Promise<ChatAck<MessageSent>> = sender
        .timeout(10000)
        .emitWithAck('message:send', {
          conversationId: conversation.id,
          clientMessageId: randomUUID(),
          content: 'Full application chat',
        });
      const [result, incoming] = await Promise.all([sending, received]);
      expect(result).toMatchObject({ ok: true, data: { created: true } });
      expect(incoming.senderId).toBe(alice.id);
      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'ChangedPassword123!',
        })
        .expect(200);
      const disconnected = event<string>(sender, 'disconnect');
      sender.emit('typing:start', { conversationId: conversation.id });
      expect(await disconnected).toBe('io server disconnect');
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(401);
      await login(alice.email).expect(401);
      const freshToken = (
        await login(alice.email, 'ChangedPassword123!').expect(200)
      ).body.accessToken;
      const freshSocket = await connect(freshToken);
      expect(freshSocket.connected).toBe(true);
      if (!result.ok) throw new Error('Expected message success');
      const deleted = event<MessageDeleted>(receiver, 'message:deleted');
      const deleting: Promise<ChatAck<MessageDeleted>> = freshSocket
        .timeout(10000)
        .emitWithAck('message:delete', { messageId: result.data.message.id });
      const [deletion, notification] = await Promise.all([deleting, deleted]);
      expect(deletion).toMatchObject({
        ok: true,
        data: { messageId: result.data.message.id },
      });
      expect(notification).toMatchObject({
        messageId: result.data.message.id,
      });
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/chat/conversations/${conversation.id}/messages`)
            .set('Authorization', `Bearer ${freshToken}`)
            .expect(200)
        ).body.total,
      ).toBe(1);
    }, 60000);
  },
);
