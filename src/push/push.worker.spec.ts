import type { DataSource, EntityManager } from 'typeorm';
import {
  PushWorker,
  MAX_PUSH_ATTEMPTS,
  MAX_RECEIPT_CHECKS,
  pushBackoff,
  RECEIPT_DELAY_MS,
} from './push.worker.js';
import { ExpoPushClient } from './expo-push.client.js';
import { PushDeviceEntity } from './entities/push-device.entity.js';
import { PushJobEntity } from './entities/push-job.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { MessageEntity } from '../chat/entities/message.entity.js';

function fixture() {
  const job = {
    id: 'job',
    messageId: 'message',
    registrationId: 'registration',
    senderDisplayName: 'Alice',
    status: 'pending',
    attempts: 0,
    receiptChecks: 0,
    createdAt: new Date(),
    nextAttemptAt: new Date(),
    ticketId: null,
  } as PushJobEntity;
  const device = {
    id: 'registration',
    userId: 'bob',
    sessionId: 'session',
    expoPushToken: 'ExpoPushToken[bob]',
  };
  const session = { revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const user = { status: UserStatus.ACTIVE };
  const message = {
    id: 'message',
    conversationId: 'conversation',
    senderId: 'alice',
    deletedAt: null,
  };
  const builder = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    setLock: vi.fn().mockReturnThis(),
    setOnLocked: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(job),
  };
  const update = vi.fn().mockImplementation((_entity, _criteria, change) => {
    Object.assign(job, change);
    return Promise.resolve();
  });
  const manager = {
    getRepository: () => ({ createQueryBuilder: () => builder }),
    findOneBy: vi
      .fn()
      .mockImplementation((entity) =>
        Promise.resolve(
          entity === PushDeviceEntity
            ? device
            : { user1Id: 'alice', user2Id: 'bob' },
        ),
      ),
    findOne: vi
      .fn()
      .mockImplementation((entity) =>
        Promise.resolve(
          entity === PushDeviceEntity
            ? device
            : entity === UserEntity
              ? user
              : entity === RefreshSessionEntity
                ? session
                : entity === MessageEntity
                  ? message
                  : null,
        ),
      ),
    update,
    delete: vi.fn(),
  };
  const transaction = vi
    .fn()
    .mockImplementation((fn: (m: EntityManager) => unknown) =>
      fn(manager as unknown as EntityManager),
    );
  const worker = new PushWorker(
    { transaction } as unknown as DataSource,
    new ExpoPushClient(),
  );
  return {
    worker,
    job,
    device,
    session,
    user,
    message,
    manager,
    builder,
    transaction,
  };
}
describe('Push worker with mocked Expo calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('sends only the sender display name and IDs, then schedules receipts', async () => {
    const { worker, job } = fixture();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: [{ status: 'ok', id: 'ticket' }] }),
      );
    vi.stubGlobal('fetch', fetch);
    await worker.processOne();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual([
      {
        to: 'ExpoPushToken[bob]',
        title: 'BlogHub',
        body: 'New message from Alice',
        sound: 'default',
        ttl: 3600,
        tag: 'message',
        collapseId: 'message',
        data: {
          type: 'chat_message',
          conversationId: 'conversation',
          messageId: 'message',
        },
      },
    ]);
    expect(job).toMatchObject({
      status: 'receipt',
      ticketId: 'ticket',
      attempts: 1,
    });
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(
      Date.now() + RECEIPT_DELAY_MS - 1000,
    );
  });
  it.each(['ticket', 'receipt'])(
    'removes invalid registrations from a %s',
    async (kind) => {
      const { worker, job, manager } = fixture();
      if (kind === 'receipt') {
        job.status = 'receipt';
        job.ticketId = 'ticket';
      }
      const error = {
        status: 'error',
        details: { error: 'DeviceNotRegistered' },
      };
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json({
            data: kind === 'ticket' ? [error] : { ticket: error },
          }),
        );
      vi.stubGlobal('fetch', fetch);
      await worker.processOne();
      expect(manager.delete).toHaveBeenCalledWith(PushDeviceEntity, {
        id: 'registration',
      });
      expect(manager.update).not.toHaveBeenCalled();
    },
  );
  it('retries transient failures with a bounded send count', async () => {
    const { worker, job } = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    );
    for (let i = 1; i <= MAX_PUSH_ATTEMPTS; i++) {
      await worker.processOne();
      expect(job.attempts).toBe(i);
      expect(job.status).toBe(i === MAX_PUSH_ATTEMPTS ? 'failed' : 'pending');
      expect(job.nextAttemptAt.getTime()).toBeGreaterThan(
        Date.now() + pushBackoff(i) - 1000,
      );
    }
    expect(pushBackoff(100)).toBe(30 * 60_000);
  });
  it('checks missing receipts without resending, with bounded polling', async () => {
    const { worker, job } = fixture();
    job.status = 'receipt';
    job.ticketId = 'ticket';
    job.attempts = 1;
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ data: {} })));
    vi.stubGlobal('fetch', fetch);
    for (let i = 0; i < MAX_RECEIPT_CHECKS; i++) await worker.processOne();
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(
      fetch.mock.calls.every(([url]) => String(url).endsWith('/getReceipts')),
    ).toBe(true);
  });
  it('completes a receipt and does not resend when receipt transport fails', async () => {
    const { worker, job } = fixture();
    job.status = 'receipt';
    job.ticketId = 'ticket';
    job.attempts = 1;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await worker.processOne();
    expect(job.status).toBe('receipt');
    expect(job.attempts).toBe(1);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ data: { ticket: { status: 'ok' } } }),
        ),
    );
    await worker.processOne();
    expect(job.status).toBe('complete');
  });
  it('retries explicit transient receipt errors and stops credential errors', async () => {
    const { worker, job, manager } = fixture();
    job.status = 'receipt';
    job.ticketId = 'ticket';
    job.attempts = 1;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            data: {
              ticket: {
                status: 'error',
                details: { error: 'MessageRateExceeded' },
              },
            },
          }),
        ),
    );
    await worker.processOne();
    expect(job.status).toBe('pending');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            data: [
              { status: 'error', details: { error: 'InvalidCredentials' } },
            ],
          }),
        ),
    );
    await worker.processOne();
    expect(job.status).toBe('failed');
    expect(manager.delete).not.toHaveBeenCalled();
  });
  it.each([
    'expired',
    'revoked',
    'disabled',
    'wrong-recipient',
    'deleted',
    'too-old',
  ])('does not deliver to %s', async (reason) => {
    const { worker, session, user, device, message, job } = fixture();
    if (reason === 'expired') session.expiresAt = new Date(0);
    if (reason === 'revoked') Object.assign(session, { revokedAt: new Date() });
    if (reason === 'disabled') user.status = UserStatus.DISABLED;
    if (reason === 'wrong-recipient') device.userId = 'alice';
    if (reason === 'deleted') Object.assign(message, { deletedAt: new Date() });
    if (reason === 'too-old') job.createdAt = new Date(0);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await worker.processOne();
    expect(fetch).not.toHaveBeenCalled();
    expect(['cancelled', 'failed']).toContain(job.status);
  });
  it('yields a contested parent lock instead of deadlocking cleanup', async () => {
    const { worker, transaction } = fixture();
    transaction.mockRejectedValue({ driverError: { code: '55P03' } });
    await expect(worker.processOne()).resolves.toBe(false);
  });
  it('does not start sending unless explicitly enabled in the worker process', async () => {
    vi.stubEnv('EXPO_PUSH_ENABLED', 'false');
    const { worker, transaction } = fixture();
    worker.onApplicationBootstrap();
    await worker.onApplicationShutdown();
    expect(transaction).not.toHaveBeenCalled();
  });
});
