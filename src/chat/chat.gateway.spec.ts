import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { ChatGateway } from './chat.gateway.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ChatService } from './chat.service.js';

type ChatSocket = Parameters<ChatGateway['handleConnection']>[0];
type ChatNamespace = Parameters<ChatGateway['afterInit']>[0];
const aliceId = randomUUID();
const bobId = randomUUID();
const conversationId = randomUUID();
const gateways: ChatGateway[] = [];

function setup() {
  const authenticate = vi.fn(async (token: string) => ({
    id: token === 'bob-token' ? bobId : aliceId,
  }));
  const saved = {
    id: randomUUID(),
    conversationId,
    senderId: aliceId,
    clientMessageId: randomUUID(),
    content: 'Hello',
    isRead: false,
    createdAt: new Date(),
  };
  const service = {
    saveMessage: vi
      .fn()
      .mockResolvedValue({ message: saved, recipientId: bobId, created: true }),
    markMessagesRead: vi.fn().mockResolvedValue({
      conversationId,
      readerId: aliceId,
      recipientId: bobId,
      updated: 2,
    }),
    findForUser: vi.fn().mockResolvedValue({
      id: conversationId,
      user1Id: aliceId,
      user2Id: bobId,
    }),
  };
  const gateway = new ChatGateway(
    { authenticate } as unknown as AuthService,
    service as unknown as ChatService,
  );
  gateways.push(gateway);
  const makeSocket = (id: string, userId: string, token: string) => {
    const socket = {
      id,
      connected: true,
      data: { userId, accessToken: token, expiresAt: Date.now() + 3_600_000 },
      handshake: { headers: {}, auth: {} },
      join: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
      disconnect: vi.fn(() => {
        socket.connected = false;
      }),
    };
    return socket as unknown as ChatSocket;
  };
  const socket = makeSocket('alice-socket', aliceId, 'alice-token');
  const recipient = makeSocket('bob-socket', bobId, 'bob-token');
  const server = {
    use: vi.fn(),
    sockets: new Map([
      [socket.id, socket],
      [recipient.id, recipient],
    ]),
    adapter: {
      rooms: new Map([
        [`user:${aliceId}`, new Set([socket.id])],
        [`user:${bobId}`, new Set([recipient.id])],
      ]),
    },
  } as unknown as ChatNamespace;
  Reflect.set(gateway, 'server', server);
  return { gateway, socket, recipient, authenticate, service, server, saved };
}

const send = () => ({
  conversationId,
  clientMessageId: randomUUID(),
  content: 'Hello',
});

describe('Chat gateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('FRONTEND_ORIGINS', 'http://localhost:3000');
  });
  afterEach(() => {
    gateways.splice(0).forEach((gateway) => gateway.onModuleDestroy());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('joins the private room, checks sessions periodically, and cleans up timers', async () => {
    const { gateway, socket, authenticate } = setup();
    await gateway.handleConnection(socket);
    expect(socket.join).toHaveBeenCalledWith(`user:${aliceId}`);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(authenticate).toHaveBeenCalledWith('alice-token');
    expect(socket.disconnect).not.toHaveBeenCalled();
    authenticate.mockRejectedValue(new Error('Session revoked'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    gateway.handleDisconnect(socket);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disconnects precisely at token expiry without waiting for the periodic check', async () => {
    const { gateway, socket } = setup();
    socket.data.expiresAt = Date.now() + 1000;
    await gateway.handleConnection(socket);
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('clears timers on disconnect and application shutdown', async () => {
    const { gateway, socket, authenticate } = setup();
    gateway.afterInit(setup().server);
    await gateway.handleConnection(socket);
    gateway.handleDisconnect(socket);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(authenticate).not.toHaveBeenCalled();
    await gateway.handleConnection(socket);
    gateway.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start timers for a disconnected or already-expired socket', async () => {
    const { gateway, socket } = setup();
    socket.connected = false;
    await gateway.handleConnection(socket);
    expect(vi.getTimerCount()).toBe(0);
    socket.connected = true;
    socket.data.expiresAt = Date.now();
    await gateway.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('acknowledges new messages and emits only to the recipient room', async () => {
    const { gateway, socket, recipient, saved, service } = setup();
    const input = send();
    expect(await gateway.sendMessage(socket, input)).toEqual({
      ok: true,
      data: { message: saved, created: true },
    });
    expect(service.saveMessage).toHaveBeenCalledWith(aliceId, input);
    expect(recipient.emit).toHaveBeenCalledWith('message:new', saved);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does not emit again for retries', async () => {
    const { gateway, socket, recipient, service } = setup();
    service.saveMessage.mockResolvedValue({
      message: setup().saved,
      recipientId: bobId,
      created: false,
    });
    expect(await gateway.sendMessage(socket, send())).toMatchObject({
      ok: true,
      data: { created: false },
    });
    expect(recipient.emit).not.toHaveBeenCalled();
  });

  it('rejects events from revoked senders and skips revoked recipients', async () => {
    const { gateway, socket, recipient, authenticate, service } = setup();
    authenticate.mockRejectedValue(new Error('Session revoked'));
    expect(await gateway.sendMessage(socket, send())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(service.saveMessage).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    socket.connected = true;
    authenticate.mockImplementation(async (token: string) => {
      if (token === 'bob-token') throw new Error('Revoked');
      return { id: aliceId };
    });
    expect(await gateway.sendMessage(socket, send())).toMatchObject({
      ok: true,
    });
    expect(recipient.disconnect).toHaveBeenCalledWith(true);
    expect(recipient.emit).not.toHaveBeenCalled();
  });

  it('rejects mismatched socket identity and expired credentials before writes', async () => {
    const { gateway, socket, authenticate, service } = setup();
    authenticate.mockResolvedValue({ id: bobId });
    expect(await gateway.sendMessage(socket, send())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    socket.connected = true;
    socket.data.expiresAt = Date.now();
    expect(
      await gateway.readMessages(socket, { conversationId }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(service.saveMessage).not.toHaveBeenCalled();
    expect(service.markMessagesRead).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    'text',
    {},
    { ...send(), content: ' \n\t' },
    { ...send(), content: 'x'.repeat(2001) },
    { ...send(), senderId: bobId },
  ])('rejects malformed message payloads (%j)', async (input) => {
    const { gateway, socket, service } = setup();
    expect(await gateway.sendMessage(socket, input)).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
    expect(service.saveMessage).not.toHaveBeenCalled();
  });

  it('returns safe permission errors and hides unexpected database details', async () => {
    const { gateway, socket, service } = setup();
    service.saveMessage.mockRejectedValue(
      new ForbiddenException('Not a participant'),
    );
    expect(await gateway.sendMessage(socket, send())).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Not a participant' },
    });
    service.saveMessage.mockRejectedValue(
      new Error('sensitive database details'),
    );
    expect(await gateway.sendMessage(socket, send())).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to process the request',
      },
    });
  });

  it('notifies the other participant only when read status changes', async () => {
    const { gateway, socket, recipient, service } = setup();
    expect(await gateway.readMessages(socket, { conversationId })).toEqual({
      ok: true,
      data: { conversationId, readerId: aliceId, updated: 2 },
    });
    expect(recipient.emit).toHaveBeenCalledWith('message:read', {
      conversationId,
      readerId: aliceId,
      updated: 2,
    });
    service.markMessagesRead.mockResolvedValue({
      conversationId,
      readerId: aliceId,
      recipientId: bobId,
      updated: 0,
    });
    await gateway.readMessages(socket, { conversationId });
    expect(recipient.emit).toHaveBeenCalledTimes(1);
  });

  it('checks typing membership, emits safe identities, and writes no messages', async () => {
    const { gateway, socket, recipient, service } = setup();
    for (const event of ['start', 'stop'] as const) {
      const result =
        event === 'start'
          ? await gateway.typingStart(socket, { conversationId })
          : await gateway.typingStop(socket, { conversationId });
      expect(result).toEqual({
        ok: true,
        data: { conversationId, userId: aliceId },
      });
      expect(recipient.emit).toHaveBeenCalledWith(`typing:${event}`, {
        conversationId,
        userId: aliceId,
      });
    }
    expect(service.findForUser).toHaveBeenCalledWith(conversationId, aliceId);
    expect(service.saveMessage).not.toHaveBeenCalled();
    service.findForUser.mockRejectedValue(new ForbiddenException());
    expect(await gateway.typingStart(socket, { conversationId })).toMatchObject(
      { ok: false, error: { code: 'FORBIDDEN' } },
    );
    expect(recipient.emit).toHaveBeenCalledTimes(2);
  });

  it('limits sending across tabs and reconnects and resets after a minute', async () => {
    const { gateway, socket, service, saved } = setup();
    service.saveMessage.mockResolvedValue({
      message: saved,
      recipientId: bobId,
      created: false,
    });
    for (let index = 0; index < 30; index++) {
      expect(await gateway.sendMessage(socket, send())).toMatchObject({
        ok: true,
      });
    }
    const anotherTab = { ...socket, id: 'another-tab' } as ChatSocket;
    gateway.handleDisconnect(socket);
    expect(await gateway.sendMessage(anotherTab, send())).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await gateway.sendMessage(anotherTab, send())).toMatchObject({
      ok: true,
    });
  });

  it('also limits typing/read events', async () => {
    const { gateway, socket } = setup();
    for (let index = 0; index < 120; index++) {
      expect(
        await gateway.typingStart(socket, { conversationId }),
      ).toMatchObject({ ok: true });
    }
    expect(
      await gateway.readMessages(socket, { conversationId }),
    ).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('cleans expired rate buckets and timers during shutdown', async () => {
    const { gateway, server, socket } = setup();
    gateway.afterInit(server);
    await gateway.sendMessage(socket, send());
    await gateway.handleConnection(socket);
    await vi.advanceTimersByTimeAsync(60_000);
    gateway.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a sender whose token expires while authentication is awaiting the database', async () => {
    const { gateway, socket, authenticate, service } = setup();
    socket.data.expiresAt = Date.now() + 1000;
    authenticate.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 2000);
      return { id: aliceId };
    });
    expect(await gateway.sendMessage(socket, send())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(service.saveMessage).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('does not deliver when a recipient expires during its authentication query', async () => {
    const { gateway, socket, recipient, authenticate } = setup();
    recipient.data.expiresAt = Date.now() + 1000;
    authenticate.mockImplementation(async (token: string) => {
      if (token === 'bob-token') {
        vi.setSystemTime(Date.now() + 2000);
        return { id: bobId };
      }
      return { id: aliceId };
    });
    expect(await gateway.sendMessage(socket, send())).toMatchObject({
      ok: true,
    });
    expect(recipient.emit).not.toHaveBeenCalled();
    expect(recipient.disconnect).toHaveBeenCalledWith(true);
  });
});
