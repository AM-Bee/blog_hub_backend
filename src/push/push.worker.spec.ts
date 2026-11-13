import type { DataSource, EntityManager } from 'typeorm';
import { Logger } from '@nestjs/common';
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

function fixture(inWeb = false) {
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
    inWeb,
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
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
  it.each([
    [true, 'true', 'false', true],
    [true, 'false', 'true', false],
    [true, undefined, 'true', false],
    [false, 'true', 'false', false],
    [false, 'false', 'true', true],
  ] as const)(
    'selects the correct opt-in flag (web=%s, web flag=%s, standalone flag=%s)',
    async (inWeb, webFlag, standaloneFlag, enabled) => {
      vi.stubEnv('EXPO_PUSH_IN_WEB', webFlag);
      vi.stubEnv('EXPO_PUSH_ENABLED', standaloneFlag);
      const { worker } = fixture(inWeb);
      const batch = vi.spyOn(worker, 'runBatch').mockResolvedValue();
      worker.onApplicationBootstrap();
      await worker.onApplicationShutdown();
      expect(batch).toHaveBeenCalledTimes(enabled ? 1 : 0);
    },
  );
  it('processes a new web job asynchronously and persists an Expo ticket', async () => {
    vi.stubEnv('EXPO_PUSH_IN_WEB', 'true');
    const { worker, job, builder } = fixture(true);
    builder.getOne.mockResolvedValueOnce(job).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ data: [{ status: 'ok', id: 'web-ticket' }] }),
        ),
    );
    worker.onApplicationBootstrap();
    expect(job.attempts).toBe(0);
    // Await the scheduled batch without changing when the real web request returns.
    await vi.waitFor(() => expect(job.status).toBe('receipt'));
    await worker.onApplicationShutdown();
    expect(job).toMatchObject({ attempts: 1, ticketId: 'web-ticket' });
  });
  it('keeps web startup independent of delivery failures', async () => {
    vi.stubEnv('EXPO_PUSH_IN_WEB', 'true');
    const { worker, job, builder } = fixture(true);
    builder.getOne.mockResolvedValueOnce(job).mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(() => worker.onApplicationBootstrap()).not.toThrow();
    await vi.waitFor(() => expect(job.attempts).toBe(1));
    await worker.onApplicationShutdown();
    expect(job).toMatchObject({
      status: 'pending',
      lastError: 'expo_network_error',
    });
  });
  it('does not overlap batches and stops polling on web shutdown', async () => {
    vi.useFakeTimers();
    vi.stubEnv('EXPO_PUSH_IN_WEB', 'true');
    const { worker } = fixture(true);
    let finish!: () => void;
    const batch = vi.spyOn(worker, 'runBatch').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(batch).toHaveBeenCalledOnce();
    const shutdown = worker.onApplicationShutdown();
    finish();
    await shutdown;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(batch).toHaveBeenCalledOnce();
  });
  it('contains database failures and retries on the next web polling cycle', async () => {
    vi.useFakeTimers();
    vi.stubEnv('EXPO_PUSH_IN_WEB', 'true');
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { worker } = fixture(true);
    const batch = vi
      .spyOn(worker, 'runBatch')
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue();
    expect(() => worker.onApplicationBootstrap()).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      'Push worker database failure; queued jobs retained',
    );
    await worker.onApplicationShutdown();
  });
});
