import 'reflect-metadata';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ChatAck } from './interface/chat-ack.interface.js';
import type {
  MessageSent,
  MessageDeleted,
  ReadReceipt,
  TypingEvent,
} from './interface/chat-event.interface.js';
import { Global, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { ChatModule } from './chat.module.js';
import { ConversationEntity } from './entities/conversation.entity.js';
import { MessageEntity } from './entities/message.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity.js';
import { AuthAccountEntity } from '../auth/entities/auth-account.entity.js';
import { AddPrivateChat1792584000000 } from '../database/migrations/1792584000000-AddPrivateChat.js';
import { AddMessageDeletion1793145600000 } from '../database/migrations/1793145600000-AddMessageDeletion.js';

const schema = `chat_rest_test_${randomUUID().replaceAll('-', '')}`;
let database: DataSource;
let connection: DataSource;
let app: INestApplication;
let alice: UserEntity;
let bob: UserEntity;
let outsider: UserEntity;
let aliceToken: string;
let bobToken: string;
let outsiderToken: string;
let socketUrl: string;
const sockets: Socket[] = [];

function connectSocket(
  token?: string,
  origin: string | null = 'http://localhost:3000',
): Promise<Socket> {
  const socket = io(`${socketUrl}/chat`, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    forceNew: true,
    timeout: 2000,
    auth: token ? { accessToken: token } : {},
    extraHeaders: origin ? { Origin: origin } : {},
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    socket.connect();
  });
}
function socketEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      3000,
    );
    socket.once(event, (data: T) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}
async function ack<T>(
  socket: Socket,
  event: string,
  input: unknown,
): Promise<ChatAck<T>> {
  return socket.timeout(3000).emitWithAck(event, input);
}
const pauseForDelivery = () =>
  new Promise((resolve) => setTimeout(resolve, 60));
function refreshCookie(response: { headers: Record<string, unknown> }): string {
  return (response.headers['set-cookie'] as string[])[0].split(';')[0];
}
function disconnectSockets() {
  for (const socket of sockets.splice(0)) socket.disconnect();
}

@Global()
@Module({
  providers: [{ provide: DataSource, useFactory: () => database }],
  exports: [DataSource],
})
class TestDatabaseModule {}
const base = '/api/v1/chat/conversations';
const create = (recipientId: string, token = aliceToken) =>
  request(app.getHttpServer())
    .post(base)
    .set('Authorization', `Bearer ${token}`)
    .send({ recipientId });
const list = (token = aliceToken, query = '') =>
  request(app.getHttpServer())
    .get(`${base}${query}`)
    .set('Authorization', `Bearer ${token}`);
const history = (id: string, token = aliceToken, query = '') =>
  request(app.getHttpServer())
    .get(`${base}/${id}/messages${query}`)
    .set('Authorization', `Bearer ${token}`);
async function message(
  conversationId: string,
  senderId: string,
  createdAt: Date,
  isRead = false,
) {
  return database.getRepository(MessageEntity).save({
    conversationId,
    senderId,
    clientMessageId: randomUUID(),
    content: '<b>Plain text</b>',
    createdAt,
    isRead,
  });
}

describe.runIf(process.env.BLOGHUB_RUN_DB_TESTS === '1')(
  'Chat REST and Socket.IO PostgreSQL',
  () => {
    beforeAll(async () => {
      dotenv.config({ quiet: true });
      vi.stubEnv(
        'JWT_SECRET',
        'chat-rest-test-secret-at-least-thirty-two-bytes',
      );
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
          UserEntity,
          RefreshSessionEntity,
          RefreshTokenEntity,
          AuthAccountEntity,
          ConversationEntity,
          MessageEntity,
        ],
        synchronize: true,
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
      const passwordHash = await bcrypt.hash('Password123!', 4);
      const user = (displayName: string, role = UserRole.AUTHOR) =>
        database.getRepository(UserEntity).save({
          displayName,
          email: `${displayName}@example.com`,
          passwordHash,
          role,
        });
      alice = await user('alice');
      bob = await user('bob');
      outsider = await user('outsider', UserRole.ADMIN);
      const module = await Test.createTestingModule({
        imports: [TestDatabaseModule, ChatModule],
      }).compile();
      app = module.createNestApplication();
      app.useLogger(false);
      app.setGlobalPrefix('api/v1');
      app.use(cookieParser());
      await app.listen(0, '127.0.0.1');
      socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
      const login = async (account: UserEntity): Promise<string> => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', 'http://localhost:3000')
          .send({ email: account.email, password: 'Password123!' })
          .expect(200);
        return response.body.accessToken;
      };
      aliceToken = await login(alice);
      bobToken = await login(bob);
      outsiderToken = await login(outsider);
    }, 30000);
    beforeEach(async () => {
      disconnectSockets();
      // DELETE uses the conversation FK cascade; only this temporary schema is touched.
      await database
        .createQueryBuilder()
        .delete()
        .from(ConversationEntity)
        .execute();
    });
    afterAll(async () => {
      disconnectSockets();
      await app?.close();
      if (database?.isInitialized) await database.destroy();
      if (connection?.isInitialized) {
        await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await connection.destroy();
      }
      vi.unstubAllEnvs();
    });

    it('requires authentication on all three routes', async () => {
      await request(app.getHttpServer())
        .post(base)
        .send({ recipientId: bob.id })
        .expect(401);
      await request(app.getHttpServer()).get(base).expect(401);
      await request(app.getHttpServer())
        .get(`${base}/${randomUUID()}/messages`)
        .expect(401);
      await list('invalid-token').expect(401);
    });

    it('rejects expired tokens, revoked sessions, and disabled accounts', async () => {
      const jwt = app.get(JwtService);
      const expired = jwt.sign(
        { sub: alice.id, sid: randomUUID(), exp: 1 },
        {
          audience: 'bloghub-api',
          issuer: 'bloghub',
        },
      );
      await list(expired).expect(401);
      const session = await database.getRepository(RefreshSessionEntity).save({
        userId: alice.id,
        expiresAt: new Date(Date.now() + 60000),
        revokedAt: new Date(),
      });
      const revoked = jwt.sign(
        { sub: alice.id, sid: session.id },
        { audience: 'bloghub-api', issuer: 'bloghub', expiresIn: 60 },
      );
      await list(revoked).expect(401);
      await database
        .getRepository(UserEntity)
        .update(alice.id, { status: UserStatus.DISABLED });
      try {
        await list().expect(401);
      } finally {
        await database
          .getRepository(UserEntity)
          .update(alice.id, { status: UserStatus.ACTIVE });
      }
    });

    it('creates one conversation and reuses it in either participant order', async () => {
      const first = (await create(bob.id).expect(200)).body;
      expect(first).toMatchObject({
        otherUser: { id: bob.id, displayName: 'bob' },
        lastMessage: null,
        unreadCount: 0,
      });
      expect((await create(bob.id).expect(200)).body.id).toBe(first.id);
      const reversed = (await create(alice.id, bobToken).expect(200)).body;
      expect(reversed.id).toBe(first.id);
      expect(reversed.otherUser).toEqual({
        id: alice.id,
        displayName: 'alice',
      });
      expect(await database.getRepository(ConversationEntity).count()).toBe(1);
    });

    it('handles concurrent creation including reversed and uppercase UUIDs', async () => {
      const responses = await Promise.all([
        create(bob.id.toUpperCase()).expect(200),
        create(alice.id.toUpperCase(), bobToken).expect(200),
        create(bob.id).expect(200),
      ]);
      expect(new Set(responses.map((response) => response.body.id)).size).toBe(
        1,
      );
      expect(await database.getRepository(ConversationEntity).count()).toBe(1);
    });

    it('rejects self, unknown recipient, invalid IDs, extra fields, and missing fields', async () => {
      await create(alice.id.toUpperCase()).expect(400);
      await create(randomUUID()).expect(404);
      await create('bad-id').expect(400);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ recipientId: bob.id, senderId: outsider.id })
        .expect(400);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({})
        .expect(400);
      expect(await database.getRepository(ConversationEntity).count()).toBe(0);
    });

    it('lists only member conversations with safe user fields and recipient-only unread counts', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      await create(bob.id, outsiderToken).expect(200);
      await message(conversation.id, alice.id, new Date('2026-01-01'));
      const latest = await message(
        conversation.id,
        bob.id,
        new Date('2026-01-02'),
      );
      await message(conversation.id, bob.id, new Date('2025-01-01'), true);
      const response = (await list().expect(200)).body;
      expect(response.total).toBe(1);
      expect(response.items[0]).toMatchObject({
        id: conversation.id,
        unreadCount: 1,
        lastMessage: {
          id: latest.id,
          content: '<b>Plain text</b>',
          createdAt: latest.createdAt.toISOString(),
        },
      });
      expect(response.items[0].otherUser).toEqual({
        id: bob.id,
        displayName: 'bob',
      });
      expect(Object.keys(response.items[0].lastMessage).sort()).toEqual(
        [
          'id',
          'conversationId',
          'senderId',
          'clientMessageId',
          'content',
          'isRead',
          'createdAt',
          'deletedAt',
        ].sort(),
      );
      const bobResponse = (await list(bobToken).expect(200)).body;
      expect(
        bobResponse.items.find(
          (item: { id: string }) => item.id === conversation.id,
        ).unreadCount,
      ).toBe(1);
      expect(JSON.stringify(response)).not.toMatch(
        /password|email|tokenHash|sessionId/,
      );
    });

    it('paginates conversations newest first and returns empty pages', async () => {
      const older = (await create(bob.id).expect(200)).body;
      const newer = (await create(outsider.id).expect(200)).body;
      await database
        .getRepository(ConversationEntity)
        .update(older.id, { updatedAt: new Date('2025-01-01') });
      const page1 = (await list(aliceToken, '?limit=1').expect(200)).body;
      expect(page1).toMatchObject({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(page1.items[0].id).toBe(newer.id);
      expect(
        (await list(aliceToken, '?page=2&limit=1').expect(200)).body.items[0]
          .id,
      ).toBe(older.id);
      expect(
        (await list(aliceToken, '?page=3&limit=1').expect(200)).body.items,
      ).toEqual([]);
    });

    it('allows both participants history, with stable newest-first ordering and no implicit read', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const at = new Date('2026-02-01');
      const first = await message(conversation.id, alice.id, at);
      const second = await message(conversation.id, bob.id, at);
      const third = await message(
        conversation.id,
        bob.id,
        new Date('2026-02-02'),
      );
      const expected = [first, second].sort((a, b) => b.id.localeCompare(a.id));
      const page1 = (
        await history(conversation.id, bobToken, '?limit=2').expect(200)
      ).body;
      expect(page1).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(page1.items.map((item: { id: string }) => item.id)).toEqual([
        third.id,
        expected[0].id,
      ]);
      const page2 = (
        await history(conversation.id, aliceToken, '?page=2&limit=2').expect(
          200,
        )
      ).body;
      expect(page2.items[0].id).toBe(expected[1].id);
      expect(
        (
          await history(conversation.id, aliceToken, '?page=3&limit=2').expect(
            200,
          )
        ).body.items,
      ).toEqual([]);
      expect(
        await database.getRepository(MessageEntity).countBy({ isRead: true }),
      ).toBe(0);
    });

    it('rejects outsider history even for an admin and handles missing/invalid conversations', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      await message(conversation.id, alice.id, new Date());
      await history(conversation.id, outsiderToken).expect(403);
      await history(randomUUID()).expect(404);
      await history('invalid').expect(400);
      expect((await list(outsiderToken).expect(200)).body.items).toEqual([]);
    });

    it('returns empty history and validates pagination and unknown query parameters', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      expect((await history(conversation.id).expect(200)).body).toEqual({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
      for (const query of [
        '?page=0',
        '?page=1.5',
        '?page=1000001',
        '?limit=51',
        '?limit=0',
        '?limit=abc',
        `?userId=${bob.id}`,
      ]) {
        await list(aliceToken, query).expect(400);
        await history(conversation.id, aliceToken, query).expect(400);
      }
    });

    it('rejects socket connections without valid credentials and from an unapproved origin', async () => {
      await expect(connectSocket()).rejects.toThrow('Authentication required');
      await expect(connectSocket('invalid-token')).rejects.toThrow(
        'Authentication failed',
      );
      await expect(
        connectSocket(aliceToken, 'https://untrusted.example'),
      ).rejects.toThrow('Origin is not allowed');
      const expired = app
        .get(JwtService)
        .sign(
          { sub: alice.id, sid: randomUUID(), exp: 1 },
          { audience: 'bloghub-api', issuer: 'bloghub' },
        );
      await expect(connectSocket(expired)).rejects.toThrow(
        'Authentication failed',
      );
    });

    it('delivers a saved message to all recipient tabs and keeps it private from an outsider', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      await database
        .getRepository(ConversationEntity)
        .update(conversation.id, { updatedAt: new Date('2025-01-01') });
      const sender = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      const receiverTab = await connectSocket(bobToken);
      const stranger = await connectSocket(outsiderToken);
      const leak = vi.fn();
      stranger.on('message:new', leak);
      const senderEcho = vi.fn();
      sender.on('message:new', senderEcho);
      const received = socketEvent<MessageEntity>(receiver, 'message:new');
      const receivedTab = socketEvent<MessageEntity>(
        receiverTab,
        'message:new',
      );
      const clientMessageId = randomUUID();
      const result = await ack<MessageSent>(sender, 'message:send', {
        conversationId: conversation.id,
        clientMessageId,
        content: 'Hello Bob',
      });
      expect(result).toMatchObject({
        ok: true,
        data: {
          created: true,
          message: { senderId: alice.id, content: 'Hello Bob', isRead: false },
        },
      });
      if (!result.ok) throw new Error('Expected success');
      expect((await received).id).toBe(result.data.message.id);
      expect((await receivedTab).id).toBe(result.data.message.id);
      expect(leak).not.toHaveBeenCalled();
      expect(senderEcho).not.toHaveBeenCalled();
      expect(await database.getRepository(MessageEntity).count()).toBe(1);
      expect(
        (await history(conversation.id, bobToken).expect(200)).body.items[0].id,
      ).toBe(result.data.message.id);
      const listed = (await list(bobToken).expect(200)).body.items[0];
      expect(listed.unreadCount).toBe(1);
      expect(listed.lastMessage.id).toBe(result.data.message.id);
      expect(new Date(listed.updatedAt).getTime()).toBeGreaterThan(
        new Date('2025-01-01').getTime(),
      );
    });

    it('acknowledges sequential and concurrent retries without duplicate rows or events', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(aliceToken);
      const anotherTab = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      const received = vi.fn();
      receiver.on('message:new', received);
      const payload = {
        conversationId: conversation.id,
        clientMessageId: randomUUID(),
        content: 'Retry safe',
      };
      const results = await Promise.all([
        ack<MessageSent>(sender, 'message:send', payload),
        ack<MessageSent>(anotherTab, 'message:send', payload),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        results.filter((result) => result.ok && result.data.created),
      ).toHaveLength(1);
      const timestamp = (
        await database
          .getRepository(ConversationEntity)
          .findOneByOrFail({ id: conversation.id })
      ).updatedAt;
      expect(await ack(sender, 'message:send', payload)).toMatchObject({
        ok: true,
        data: { created: false },
      });
      expect(
        (
          await database
            .getRepository(ConversationEntity)
            .findOneByOrFail({ id: conversation.id })
        ).updatedAt,
      ).toEqual(timestamp);
      await pauseForDelivery();
      expect(received).toHaveBeenCalledTimes(1);
      expect(await database.getRepository(MessageEntity).count()).toBe(1);
      expect(
        await ack(sender, 'message:send', { ...payload, content: 'Changed' }),
      ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      const otherConversation = (await create(outsider.id).expect(200)).body;
      expect(
        await ack(sender, 'message:send', {
          ...payload,
          conversationId: otherConversation.id,
        }),
      ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(await ack(receiver, 'message:send', payload)).toMatchObject({
        ok: true,
        data: { created: true },
      });
      expect(await database.getRepository(MessageEntity).count()).toBe(2);
    });

    it('rejects outsider sends, reads, and typing even when the outsider is an admin', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const stranger = await connectSocket(outsiderToken);
      const receiver = await connectSocket(bobToken);
      const events = vi.fn();
      receiver.onAny(events);
      for (const event of [
        'message:send',
        'message:read',
        'typing:start',
        'typing:stop',
      ]) {
        const payload =
          event === 'message:send'
            ? {
                conversationId: conversation.id,
                clientMessageId: randomUUID(),
                content: 'Forbidden',
              }
            : { conversationId: conversation.id };
        expect(await ack(stranger, event, payload)).toMatchObject({
          ok: false,
          error: { code: 'FORBIDDEN' },
        });
      }
      expect(await database.getRepository(MessageEntity).count()).toBe(0);
      expect(events).not.toHaveBeenCalled();
    });

    it('validates socket payloads and rejects sender impersonation and empty or oversized content', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(bobToken);
      const payload = {
        conversationId: conversation.id,
        clientMessageId: randomUUID(),
        content: 'Hello',
      };
      for (const input of [
        null,
        [],
        'text',
        {},
        { ...payload, senderId: alice.id },
        { ...payload, content: ' \n\t' },
        { ...payload, content: 'x'.repeat(2001) },
        { ...payload, conversationId: 'bad-id' },
      ]) {
        expect(await ack(sender, 'message:send', input)).toMatchObject({
          ok: false,
          error: { code: 'BAD_REQUEST' },
        });
      }
      expect(await database.getRepository(MessageEntity).count()).toBe(0);
      expect(
        await ack(sender, 'message:send', {
          ...payload,
          content: '😀'.repeat(2000),
        }),
      ).toMatchObject({ ok: true, data: { created: true } });
      expect(
        await ack(sender, 'message:send', {
          ...payload,
          clientMessageId: randomUUID(),
          content: '😀'.repeat(2001),
        }),
      ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
      expect(
        await ack(sender, 'message:read', {
          conversationId: conversation.id,
          readerId: alice.id,
        }),
      ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
      expect(
        await ack(sender, 'typing:start', { conversationId: randomUUID() }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });

    it('marks only received messages as read and notifies the other participant once', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const inbound = await message(conversation.id, alice.id, new Date());
      const own = await message(conversation.id, bob.id, new Date());
      const sender = await connectSocket(aliceToken);
      const reader = await connectSocket(bobToken);
      const receipts = vi.fn();
      sender.on('message:read', receipts);
      const receipt = socketEvent<ReadReceipt>(sender, 'message:read');
      expect(
        await ack(reader, 'message:read', { conversationId: conversation.id }),
      ).toEqual({
        ok: true,
        data: { conversationId: conversation.id, readerId: bob.id, updated: 1 },
      });
      expect(await receipt).toMatchObject({ readerId: bob.id, updated: 1 });
      expect(
        (
          await database
            .getRepository(MessageEntity)
            .findOneByOrFail({ id: inbound.id })
        ).isRead,
      ).toBe(true);
      expect(
        (
          await database
            .getRepository(MessageEntity)
            .findOneByOrFail({ id: own.id })
        ).isRead,
      ).toBe(false);
      expect(
        await ack(reader, 'message:read', { conversationId: conversation.id }),
      ).toMatchObject({ ok: true, data: { updated: 0 } });
      await pauseForDelivery();
      expect(receipts).toHaveBeenCalledTimes(1);
      expect((await list(bobToken).expect(200)).body.items[0].unreadCount).toBe(
        0,
      );
      expect(
        (await list(aliceToken).expect(200)).body.items[0].unreadCount,
      ).toBe(1);
    });

    it('sends typing only to the other participant and does not persist it', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      const stranger = await connectSocket(outsiderToken);
      const leaks = vi.fn();
      stranger.onAny(leaks);
      for (const event of ['typing:start', 'typing:stop']) {
        const received = socketEvent<TypingEvent>(receiver, event);
        expect(
          await ack(sender, event, { conversationId: conversation.id }),
        ).toEqual({
          ok: true,
          data: { conversationId: conversation.id, userId: alice.id },
        });
        expect(await received).toEqual({
          conversationId: conversation.id,
          userId: alice.id,
        });
      }
      expect(leaks).not.toHaveBeenCalled();
      expect(await database.getRepository(MessageEntity).count()).toBe(0);
    });

    it('rechecks recipient sessions before private delivery and keeps the saved message', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      const events = vi.fn();
      receiver.on('message:new', events);
      const session = app.get(JwtService).decode<{ sid: string }>(bobToken).sid;
      await database
        .getRepository(RefreshSessionEntity)
        .update(session, { revokedAt: new Date() });
      try {
        const disconnected = socketEvent<string>(receiver, 'disconnect');
        expect(
          await ack(sender, 'message:send', {
            conversationId: conversation.id,
            clientMessageId: randomUUID(),
            content: 'Stored while offline',
          }),
        ).toMatchObject({ ok: true });
        expect(await disconnected).toBe('io server disconnect');
        expect(events).not.toHaveBeenCalled();
        expect(await database.getRepository(MessageEntity).count()).toBe(1);
      } finally {
        await database
          .getRepository(RefreshSessionEntity)
          .update(session, { revokedAt: null });
      }
    });

    it('rejects the next event from a revoked sender and disconnects it', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(aliceToken);
      const session = app
        .get(JwtService)
        .decode<{ sid: string }>(aliceToken).sid;
      await database
        .getRepository(RefreshSessionEntity)
        .update(session, { revokedAt: new Date() });
      try {
        const disconnected = socketEvent<string>(sender, 'disconnect');
        sender.emit('message:send', {
          conversationId: conversation.id,
          clientMessageId: randomUUID(),
          content: 'Rejected',
        });
        expect(await disconnected).toBe('io server disconnect');
        expect(await database.getRepository(MessageEntity).count()).toBe(0);
      } finally {
        await database
          .getRepository(RefreshSessionEntity)
          .update(session, { revokedAt: null });
      }
    });

    it('disconnects an idle socket when its access token expires', async () => {
      const session = app
        .get(JwtService)
        .decode<{ sid: string }>(aliceToken).sid;
      const shortToken = app
        .get(JwtService)
        .sign(
          { sub: alice.id, sid: session },
          { audience: 'bloghub-api', issuer: 'bloghub', expiresIn: 2 },
        );
      const socket = await connectSocket(shortToken);
      expect(await socketEvent<string>(socket, 'disconnect')).toBe(
        'io server disconnect',
      );
    });

    it('rolls back message insertion when updating the conversation fails', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(aliceToken);
      await database.query(
        `CREATE FUNCTION "${schema}".reject_chat_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database details'; END; $$`,
      );
      await database.query(
        `CREATE TRIGGER reject_chat_update BEFORE UPDATE ON "${schema}".chat_conversations FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_chat_update()`,
      );
      try {
        expect(
          await ack(sender, 'message:send', {
            conversationId: conversation.id,
            clientMessageId: randomUUID(),
            content: 'Rolled back',
          }),
        ).toEqual({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Unable to process the request',
          },
        });
        expect(await database.getRepository(MessageEntity).count()).toBe(0);
      } finally {
        await database.query(
          `DROP TRIGGER reject_chat_update ON "${schema}".chat_conversations`,
        );
        await database.query(`DROP FUNCTION "${schema}".reject_chat_update()`);
      }
    });

    it('recovers offline messages through history and resumes live delivery after reconnecting', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      receiver.disconnect();
      const payload = {
        conversationId: conversation.id,
        clientMessageId: randomUUID(),
        content: 'While offline',
      };
      const sent = await ack<MessageSent>(sender, 'message:send', payload);
      expect(sent).toMatchObject({ ok: true, data: { created: true } });
      if (!sent.ok) throw new Error('Expected success');
      const reconnected = await connectSocket(bobToken);
      expect(
        (await history(conversation.id, bobToken).expect(200)).body.items[0].id,
      ).toBe(sent.data.message.id);
      expect((await list(bobToken).expect(200)).body.items[0].unreadCount).toBe(
        1,
      );
      const received = socketEvent<MessageEntity>(reconnected, 'message:new');
      const next = await ack<MessageSent>(sender, 'message:send', {
        ...payload,
        clientMessageId: randomUUID(),
        content: 'Live again',
      });
      expect(next).toMatchObject({ ok: true, data: { created: true } });
      expect((await received).content).toBe('Live again');
      expect(await database.getRepository(MessageEntity).count()).toBe(2);
    });

    it('uses the existing refresh-cookie flow to reconnect after expiry and honors logout', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: bob.email, password: 'Password123!' })
        .expect(200);
      const initialCookie = refreshCookie(login);
      const session = app
        .get(JwtService)
        .decode<{ sid: string }>(login.body.accessToken).sid;
      const shortToken = app
        .get(JwtService)
        .sign(
          { sub: bob.id, sid: session },
          { audience: 'bloghub-api', issuer: 'bloghub', expiresIn: 2 },
        );
      const expiredSocket = await connectSocket(shortToken);
      await socketEvent<string>(expiredSocket, 'disconnect');
      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', initialCookie)
        .expect(200);
      const rotatedCookie = refreshCookie(refresh);
      expect(rotatedCookie).not.toBe(initialCookie);
      await expect(connectSocket(shortToken)).rejects.toThrow(
        'Authentication failed',
      );
      const receiver = await connectSocket(refresh.body.accessToken);
      const sender = await connectSocket(aliceToken);
      const received = socketEvent<MessageEntity>(receiver, 'message:new');
      expect(
        await ack(sender, 'message:send', {
          conversationId: conversation.id,
          clientMessageId: randomUUID(),
          content: 'After refresh',
        }),
      ).toMatchObject({ ok: true });
      expect((await received).content).toBe('After refresh');
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', rotatedCookie)
        .expect(200);
      const disconnected = socketEvent<string>(receiver, 'disconnect');
      receiver.emit('typing:start', { conversationId: conversation.id });
      expect(await disconnected).toBe('io server disconnect');
      await history(conversation.id, refresh.body.accessToken).expect(401);
    });

    it('rejects a disabled connected user on the next event without changing messages', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const receiver = await connectSocket(bobToken);
      await database
        .getRepository(UserEntity)
        .update(bob.id, { status: UserStatus.DISABLED });
      try {
        const disconnected = socketEvent<string>(receiver, 'disconnect');
        receiver.emit('message:read', { conversationId: conversation.id });
        expect(await disconnected).toBe('io server disconnect');
        await expect(connectSocket(bobToken)).rejects.toThrow(
          'Authentication failed',
        );
        expect(await database.getRepository(MessageEntity).count()).toBe(0);
      } finally {
        await database
          .getRepository(UserEntity)
          .update(bob.id, { status: UserStatus.ACTIVE });
      }
    });

    it('allows a token-authenticated non-browser client and rejects wrong JWT audience or issuer', async () => {
      const valid = await connectSocket(aliceToken, null);
      expect(valid.connected).toBe(true);
      const session = app
        .get(JwtService)
        .decode<{ sid: string }>(aliceToken).sid;
      for (const claims of [
        { audience: 'another-api', issuer: 'bloghub' },
        { audience: 'bloghub-api', issuer: 'another-issuer' },
      ]) {
        const token = app
          .get(JwtService)
          .sign({ sub: alice.id, sid: session }, { ...claims, expiresIn: 60 });
        await expect(connectSocket(token)).rejects.toThrow(
          'Authentication failed',
        );
      }
    });

    it('deletes the sender text for everyone and notifies both participants across their tabs', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const saved = await message(conversation.id, alice.id, new Date());
      const sender = await connectSocket(aliceToken);
      const senderTab = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      const receiverTab = await connectSocket(bobToken);
      const stranger = await connectSocket(outsiderToken);
      const leaked = vi.fn();
      stranger.on('message:deleted', leaked);
      const before = await database
        .getRepository(ConversationEntity)
        .findOneByOrFail({ id: conversation.id });
      expect((await list(bobToken).expect(200)).body.items[0].unreadCount).toBe(
        1,
      );
      const events = [sender, senderTab, receiver, receiverTab].map((socket) =>
        socketEvent<MessageDeleted>(socket, 'message:deleted'),
      );
      const result = await ack<MessageDeleted>(sender, 'message:delete', {
        messageId: saved.id.toUpperCase(),
      });
      expect(result).toMatchObject({
        ok: true,
        data: {
          messageId: saved.id,
          conversationId: conversation.id,
          deletedAt: expect.any(String),
        },
      });
      if (!result.ok) throw new Error('Expected success');
      for (const event of await Promise.all(events))
        expect(event).toEqual(result.data);
      expect(leaked).not.toHaveBeenCalled();
      const stored = await database
        .getRepository(MessageEntity)
        .findOneByOrFail({ id: saved.id });
      expect(stored.content).toBeNull();
      expect(stored.deletedAt?.toISOString()).toBe(result.data.deletedAt);
      expect(stored.createdAt).toEqual(saved.createdAt);
      const preview = (await list(bobToken).expect(200)).body.items[0];
      expect(preview.unreadCount).toBe(0);
      expect(preview.lastMessage).toMatchObject({
        id: saved.id,
        content: null,
        deletedAt: result.data.deletedAt,
      });
      expect(new Date(preview.updatedAt)).toEqual(before.updatedAt);
      for (const token of [aliceToken, bobToken]) {
        const page = (await history(conversation.id, token).expect(200)).body;
        expect(page.total).toBe(1);
        expect(page.items[0]).toMatchObject({
          id: saved.id,
          senderId: alice.id,
          content: null,
          deletedAt: result.data.deletedAt,
        });
        expect(JSON.stringify(page)).not.toContain(saved.content);
      }
      expect(
        await ack(receiver, 'message:read', {
          conversationId: conversation.id,
        }),
      ).toMatchObject({ ok: true, data: { updated: 0 } });
      expect(
        (
          await database
            .getRepository(MessageEntity)
            .findOneByOrFail({ id: saved.id })
        ).isRead,
      ).toBe(false);
    });

    it('allows only the sender to delete, including when a participant is an admin', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const saved = await message(conversation.id, alice.id, new Date());
      const receiver = await connectSocket(bobToken);
      const admin = await connectSocket(outsiderToken);
      expect(
        await ack(receiver, 'message:delete', { messageId: saved.id }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(
        await ack(admin, 'message:delete', { messageId: saved.id }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(
        (
          await database
            .getRepository(MessageEntity)
            .findOneByOrFail({ id: saved.id })
        ).content,
      ).toBe(saved.content);
      const ownConversation = (
        await create(alice.id, outsiderToken).expect(200)
      ).body;
      const authorMessage = await message(
        ownConversation.id,
        alice.id,
        new Date(),
      );
      expect(
        await ack(admin, 'message:delete', { messageId: authorMessage.id }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const adminMessage = await message(
        ownConversation.id,
        outsider.id,
        new Date(),
      );
      expect(
        await ack(admin, 'message:delete', { messageId: adminMessage.id }),
      ).toMatchObject({ ok: true });
    });

    it('validates delete payloads and handles unknown messages safely', async () => {
      const sender = await connectSocket(aliceToken);
      for (const input of [
        null,
        [],
        {},
        { messageId: 'invalid' },
        { messageId: randomUUID(), senderId: bob.id },
      ]) {
        expect(await ack(sender, 'message:delete', input)).toMatchObject({
          ok: false,
          error: { code: 'BAD_REQUEST' },
        });
      }
      expect(
        await ack(sender, 'message:delete', { messageId: randomUUID() }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });

    it('serializes simultaneous deletions and preserves the first timestamp without repeated events', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const saved = await message(conversation.id, alice.id, new Date());
      const first = await connectSocket(aliceToken);
      const second = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      const received = vi.fn();
      receiver.on('message:deleted', received);
      const results = await Promise.all([
        ack<MessageDeleted>(first, 'message:delete', { messageId: saved.id }),
        ack<MessageDeleted>(second, 'message:delete', { messageId: saved.id }),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0].ok).toBe(true);
      expect(
        await ack(first, 'message:delete', { messageId: saved.id }),
      ).toEqual(results[0]);
      await pauseForDelivery();
      expect(received).toHaveBeenCalledTimes(1);
      expect(await database.getRepository(MessageEntity).count()).toBe(1);
    });

    it('never resurrects or emits a deleted message when its original send is retried', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const sender = await connectSocket(aliceToken);
      const receiver = await connectSocket(bobToken);
      const payload = {
        conversationId: conversation.id,
        clientMessageId: randomUUID(),
        content: 'Remove this text',
      };
      const sent = await ack<MessageSent>(sender, 'message:send', payload);
      if (!sent.ok) throw new Error('Expected success');
      await ack(sender, 'message:delete', { messageId: sent.data.message.id });
      const events = vi.fn();
      receiver.on('message:new', events);
      expect(await ack(sender, 'message:send', payload)).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT' },
      });
      await pauseForDelivery();
      expect(events).not.toHaveBeenCalled();
      const stored = await database
        .getRepository(MessageEntity)
        .findOneByOrFail({ id: sent.data.message.id });
      expect(stored.content).toBeNull();
      expect(stored.deletedAt).not.toBeNull();
      expect(await database.getRepository(MessageEntity).count()).toBe(1);
    });

    it('coordinates deletion with concurrent read updates', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const saved = await message(conversation.id, alice.id, new Date());
      const sender = await connectSocket(aliceToken);
      const reader = await connectSocket(bobToken);
      const results = await Promise.all([
        ack(sender, 'message:delete', { messageId: saved.id }),
        ack(reader, 'message:read', { conversationId: conversation.id }),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect((await list(bobToken).expect(200)).body.items[0].unreadCount).toBe(
        0,
      );
      expect(
        (
          await database
            .getRepository(MessageEntity)
            .findOneByOrFail({ id: saved.id })
        ).content,
      ).toBeNull();
    });

    it('returns the deleted placeholder to a recipient reconnecting after deletion', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const saved = await message(conversation.id, alice.id, new Date());
      const sender = await connectSocket(aliceToken);
      expect(
        await ack(sender, 'message:delete', { messageId: saved.id }),
      ).toMatchObject({ ok: true });
      expect((await connectSocket(bobToken)).connected).toBe(true);
      const page = (await history(conversation.id, bobToken).expect(200)).body;
      expect(page.items[0]).toMatchObject({
        id: saved.id,
        content: null,
        deletedAt: expect.any(String),
      });
      expect(JSON.stringify(page)).not.toContain(saved.content);
    });

    it('keeps old messages intact through migration revert/reapply and prevents unsafe rollback after deletion', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const saved = await message(conversation.id, alice.id, new Date());
      const runner = database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SET LOCAL search_path TO "${schema}", public`);
        const migration = new AddMessageDeletion1793145600000();
        await migration.down(runner);
        expect(
          (
            await runner.query(
              'SELECT content FROM chat_messages WHERE id = $1',
              [saved.id],
            )
          )[0].content,
        ).toBe(saved.content);
        await migration.up(runner);
        await migration.up(runner);
        const rows = await runner.query(
          'SELECT content, deleted_at FROM chat_messages WHERE id = $1',
          [saved.id],
        );
        expect(rows[0]).toMatchObject({
          content: saved.content,
          deleted_at: null,
        });
        await runner.query(
          'UPDATE chat_messages SET content = NULL, deleted_at = now() WHERE id = $1',
          [saved.id],
        );
        await expect(migration.down(runner)).rejects.toThrow(
          'Cannot revert message deletion',
        );
        expect(
          (
            await runner.query(
              'SELECT content, deleted_at FROM chat_messages WHERE id = $1',
              [saved.id],
            )
          )[0].content,
        ).toBeNull();
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('enforces nonblank live text and text-free deleted placeholders in PostgreSQL', async () => {
      const conversation = (await create(bob.id).expect(200)).body;
      const saved = await message(conversation.id, alice.id, new Date());
      const messages = database.getRepository(MessageEntity);
      for (const update of [
        { content: null },
        { content: '   ' },
        { deletedAt: new Date() },
      ]) {
        await expect(messages.update(saved.id, update)).rejects.toMatchObject({
          driverError: {
            code: '23514',
            constraint: 'CK_chat_messages_content',
          },
        });
      }
      await messages.update(saved.id, { content: null, deletedAt: new Date() });
      await expect(
        messages.update(saved.id, {
          content: 'Cannot leave text on a deleted placeholder',
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    });
  },
);
