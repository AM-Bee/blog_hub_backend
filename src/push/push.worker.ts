import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PushDeviceEntity } from './entities/push-device.entity.js';
import { PushJobEntity } from './entities/push-job.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { MessageEntity } from '../chat/entities/message.entity.js';
import { ConversationEntity } from '../chat/entities/conversation.entity.js';
import {
  ExpoPushClient,
  ExpoPushError,
  retryableExpoError,
} from './expo-push.client.js';

export const MAX_PUSH_ATTEMPTS = 6;
export const MAX_RECEIPT_CHECKS = 8;
export const RECEIPT_DELAY_MS = 15 * 60_000;
export const pushBackoff = (attempt: number) =>
  Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000);

@Injectable()
export class PushWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PushWorker.name);
  private stopping = false;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(
    @Inject(DataSource) private readonly database: DataSource,
    @Inject(ExpoPushClient) private readonly expo: ExpoPushClient,
  ) {}

  onApplicationBootstrap() {
    if (process.env.EXPO_PUSH_ENABLED !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = this.runBatch()
        .catch(() =>
          this.logger.error(
            'Push worker database failure; queued jobs retained',
          ),
        )
        .finally(() => {
          this.running = undefined;
        });
    };
    this.timer = setInterval(tick, 5000);
    tick();
  }
  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  // shortcut: one Expo request at a time per worker; add batching if sustained queue volume grows.
  async runBatch(): Promise<void> {
    for (let count = 0; count < 25 && !this.stopping; count++)
      if (!(await this.processOne())) break;
  }

  async processOne(): Promise<boolean> {
    try {
      return await this.database.transaction(async (manager) => {
        const job = await manager
          .getRepository(PushJobEntity)
          .createQueryBuilder('job')
          .where(
            'job.status IN (:...states) AND job.nextAttemptAt <= CURRENT_TIMESTAMP',
            { states: ['pending', 'receipt'] },
          )
          .orderBy('job.nextAttemptAt', 'ASC')
          .addOrderBy('job.id', 'ASC')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getOne();
        if (!job) return false;
        const device = await this.activeDevice(manager, job.registrationId);
        const message = await manager.findOne(MessageEntity, {
          where: { id: job.messageId },
          select: {
            id: true,
            conversationId: true,
            senderId: true,
            deletedAt: true,
          },
        });
        const conversation =
          message &&
          (await manager.findOneBy(ConversationEntity, {
            id: message.conversationId,
          }));
        const recipientId =
          conversation &&
          message &&
          (conversation.user1Id === message.senderId
            ? conversation.user2Id
            : conversation.user1Id);
        if (
          !device ||
          !message ||
          message.deletedAt ||
          recipientId !== device.userId ||
          message.senderId === device.userId
        ) {
          await manager.update(
            PushJobEntity,
            { id: job.id },
            { status: 'cancelled' },
          );
          return true;
        }
        if (job.createdAt.getTime() < Date.now() - 24 * 60 * 60_000) {
          await manager.update(
            PushJobEntity,
            { id: job.id },
            { status: 'failed', lastError: 'job_expired' },
          );
          return true;
        }
        const checkingReceipt = job.status === 'receipt';
        if (checkingReceipt) job.receiptChecks++;
        else job.attempts++;
        try {
          const result = checkingReceipt
            ? await this.expo.receipt(job.ticketId!)
            : await this.expo.send({
                to: device.expoPushToken,
                title: 'BlogHub',
                body: `New message from ${job.senderDisplayName}`,
                sound: 'default',
                ttl: 3600,
                tag: job.messageId,
                collapseId: job.messageId,
                data: {
                  type: 'chat_message',
                  conversationId: message.conversationId,
                  messageId: message.id,
                },
              });
          if (!result) this.retryReceipt(job, 'receipt_missing');
          else if (result.status === 'error') {
            const code =
              typeof result.details?.error === 'string'
                ? result.details.error.slice(0, 80)
                : 'expo_unknown_error';
            if (code === 'DeviceNotRegistered') {
              await manager.delete(PushDeviceEntity, { id: device.id });
              return true;
            }
            this.retrySend(job, code, retryableExpoError(code));
          } else if (checkingReceipt) {
            job.status = 'complete';
            job.lastError = null;
          } else {
            job.status = 'receipt';
            job.ticketId = result.id!;
            job.receiptChecks = 0;
            job.lastError = null;
            job.nextAttemptAt = new Date(Date.now() + RECEIPT_DELAY_MS);
          }
        } catch (error) {
          const code =
            error instanceof ExpoPushError
              ? error.code
              : 'expo_unexpected_error';
          const retryable =
            error instanceof ExpoPushError ? error.retryable : true;
          if (checkingReceipt && retryable) this.retryReceipt(job, code);
          else this.retrySend(job, code, retryable);
        }
        await manager.update(
          PushJobEntity,
          { id: job.id },
          {
            status: job.status,
            attempts: job.attempts,
            receiptChecks: job.receiptChecks,
            ticketId: job.ticketId,
            lastError: job.lastError,
            nextAttemptAt: job.nextAttemptAt,
          },
        );
        if (job.status === 'failed')
          this.logger.warn(`Push job ${job.id} failed: ${job.lastError}`);
        return true;
      });
    } catch (error) {
      // Parent cleanup may already hold a registration/session lock. Yield instead of deadlocking its cascade.
      if (
        (error as { code?: string }).code === '55P03' ||
        (error as { driverError?: { code?: string } }).driverError?.code ===
          '55P03'
      )
        return false;
      throw error;
    }
  }

  private retrySend(job: PushJobEntity, code: string, retryable: boolean) {
    job.lastError = code;
    job.ticketId = null;
    job.status =
      retryable && job.attempts < MAX_PUSH_ATTEMPTS ? 'pending' : 'failed';
    job.nextAttemptAt = new Date(Date.now() + pushBackoff(job.attempts));
  }
  private retryReceipt(job: PushJobEntity, code: string) {
    job.lastError = code;
    job.status = job.receiptChecks < MAX_RECEIPT_CHECKS ? 'receipt' : 'failed';
    job.nextAttemptAt = new Date(Date.now() + pushBackoff(job.receiptChecks));
  }

  private async activeDevice(manager: EntityManager, id: string) {
    const reference = await manager.findOneBy(PushDeviceEntity, { id });
    if (!reference) return null;
    // Hold short parent read locks through the bounded Expo request: completed logout/switch cannot race a later send.
    const user = await manager.findOne(UserEntity, {
      where: { id: reference.userId },
      lock: { mode: 'pessimistic_read', onLocked: 'nowait' },
    });
    const session = await manager.findOne(RefreshSessionEntity, {
      where: { id: reference.sessionId, userId: reference.userId },
      lock: { mode: 'pessimistic_read', onLocked: 'nowait' },
    });
    const device = await manager.findOne(PushDeviceEntity, {
      where: { id },
      lock: { mode: 'for_no_key_update', onLocked: 'nowait' },
    });
    return device &&
      user?.status === UserStatus.ACTIVE &&
      session &&
      !session.revokedAt &&
      session.expiresAt.getTime() > Date.now()
      ? device
      : null;
  }
}
