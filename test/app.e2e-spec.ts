import 'reflect-metadata';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module.js';
import { seedEntities } from '../src/seed.js';
import { UserEntity } from '../src/users/entities/user.entity.js';
import { UserRole } from '../src/users/enums/user-role.enum.js';
import { AuthAccountEntity } from '../src/auth/entities/auth-account.entity.js';
import { BlogAuditLogEntity } from '../src/blogs/entities/blog-audit-log.entity.js';
import { NotificationEntity } from '../src/notifications/entities/notification.entity.js';
import { ConversationEntity } from '../src/chat/entities/conversation.entity.js';
import { MessageEntity } from '../src/chat/entities/message.entity.js';
import { AddPrivateChat1792584000000 } from '../src/database/migrations/1792584000000-AddPrivateChat.js';
import { AddMessageDeletion1793145600000 } from '../src/database/migrations/1793145600000-AddMessageDeletion.js';
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
let app: INestApplication;
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
      3000,
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
        synchronize: true,
        entities: [
          ...seedEntities,
          AuthAccountEntity,
          BlogAuditLogEntity,
          NotificationEntity,
          ConversationEntity,
          MessageEntity,
        ],
      }).initialize();
      const runner = database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SET LOCAL search_path TO "${schema}", public`);
        await new AddPrivateChat1792584000000().up(runner);
        await new AddMessageDeletion1793145600000().up(runner);
        await runner.commitTransaction();
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
      // Override the real application's connection so its dev synchronize cannot touch public tables.
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DataSource)
        .useValue(database)
        .compile();
      app = module.createNestApplication();
      app.useLogger(false);
      app.setGlobalPrefix('api/v1');
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
      const result: ChatAck<MessageSent> = await sender
        .timeout(3000)
        .emitWithAck('message:send', {
          conversationId: conversation.id,
          clientMessageId: randomUUID(),
          content: 'Full application chat',
        });
      expect(result).toMatchObject({ ok: true, data: { created: true } });
      expect((await received).senderId).toBe(alice.id);
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
      const deletion: ChatAck<MessageDeleted> = await freshSocket
        .timeout(3000)
        .emitWithAck('message:delete', { messageId: result.data.message.id });
      expect(deletion).toMatchObject({
        ok: true,
        data: { messageId: result.data.message.id },
      });
      expect(await deleted).toMatchObject({
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
    });
  },
);
