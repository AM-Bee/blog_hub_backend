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
const messageId = randomUUID();
const conversationId = randomUUID();

function setup() {
  const authenticate = vi.fn(async (token: string) => ({
    id: token === 'bob' ? bobId : aliceId,
  }));
  const deletedAt = new Date();
  const service = {
    deleteMessage: vi
      .fn()
      .mockResolvedValue({
        messageId,
        conversationId,
        deletedAt,
        recipientId: bobId,
        changed: true,
      }),
  };
  const gateway = new ChatGateway(
    { authenticate } as unknown as AuthService,
    service as unknown as ChatService,
  );
  const socket = (id: string, userId: string, token: string) =>
    ({
      id,
      connected: true,
      data: { userId, accessToken: token, expiresAt: Date.now() + 60_000 },
      emit: vi.fn(),
      disconnect: vi.fn(),
    }) as unknown as ChatSocket;
  const sender = socket('alice-tab', aliceId, 'alice');
  const receiver = socket('bob-tab', bobId, 'bob');
  Reflect.set(gateway, 'server', {
    sockets: new Map([
      [sender.id, sender],
      [receiver.id, receiver],
    ]),
    adapter: {
      rooms: new Map([
        [`user:${aliceId}`, new Set([sender.id])],
        [`user:${bobId}`, new Set([receiver.id])],
      ]),
    },
  } as unknown as ChatNamespace);
  return { gateway, sender, receiver, service, authenticate, deletedAt };
}

describe('Message deletion gateway', () => {
  it('acknowledges deletion and notifies both participants without exposing internal routing fields', async () => {
    const { gateway, sender, receiver, service, deletedAt } = setup();
    const deletion = { messageId, conversationId, deletedAt };
    expect(await gateway.deleteMessage(sender, { messageId })).toEqual({
      ok: true,
      data: deletion,
    });
    expect(service.deleteMessage).toHaveBeenCalledWith(aliceId, { messageId });
    expect(sender.emit).toHaveBeenCalledWith('message:deleted', deletion);
    expect(receiver.emit).toHaveBeenCalledWith('message:deleted', deletion);
  });

  it('does not emit again when the message was already deleted', async () => {
    const { gateway, sender, receiver, service } = setup();
    service.deleteMessage.mockResolvedValue({
      messageId,
      conversationId,
      deletedAt: new Date(),
      recipientId: bobId,
      changed: false,
    });
    expect(await gateway.deleteMessage(sender, { messageId })).toMatchObject({
      ok: true,
    });
    expect(sender.emit).not.toHaveBeenCalled();
    expect(receiver.emit).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { messageId: 'invalid' },
    { messageId, senderId: bobId },
  ])('rejects malformed or extra fields (%j)', async (input) => {
    const { gateway, sender, service } = setup();
    expect(await gateway.deleteMessage(sender, input)).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
    expect(service.deleteMessage).not.toHaveBeenCalled();
  });

  it('reauthenticates before deletion and disconnects a revoked sender', async () => {
    const { gateway, sender, service, authenticate } = setup();
    authenticate.mockRejectedValue(new Error('Revoked session'));
    expect(await gateway.deleteMessage(sender, { messageId })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(sender.disconnect).toHaveBeenCalledWith(true);
    expect(service.deleteMessage).not.toHaveBeenCalled();
  });

  it('preserves permission errors and hides unexpected server details', async () => {
    const { gateway, sender, service } = setup();
    service.deleteMessage.mockRejectedValue(
      new ForbiddenException('You can only delete your own messages'),
    );
    expect(await gateway.deleteMessage(sender, { messageId })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    service.deleteMessage.mockRejectedValue(
      new Error('Database connection details'),
    );
    expect(await gateway.deleteMessage(sender, { messageId })).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to process the request',
      },
    });
  });

  it('counts deletion attempts toward the shared total-event quota', async () => {
    const { gateway, sender, service, deletedAt } = setup();
    service.deleteMessage.mockResolvedValue({
      messageId,
      conversationId,
      deletedAt,
      recipientId: bobId,
      changed: false,
    });
    for (let index = 0; index < 120; index++) {
      expect(await gateway.deleteMessage(sender, { messageId })).toMatchObject({
        ok: true,
      });
    }
    expect(await gateway.deleteMessage(sender, { messageId })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
  });
});
