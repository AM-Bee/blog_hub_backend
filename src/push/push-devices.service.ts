import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { validateDto } from '../common/validation.utils.js';
import { PushDeviceEntity } from './entities/push-device.entity.js';
import { RegisterPushDeviceDto } from './dto/push-device.dto.js';

@Injectable()
export class PushDevicesService {
  constructor(@Inject(DataSource) private readonly database: DataSource) {}

  async register(
    deviceId: string,
    input: RegisterPushDeviceDto,
    userId: string,
    sessionId: string,
  ) {
    deviceId = deviceId.toLowerCase();
    const dto = await validateDto(input, RegisterPushDeviceDto);
    await this.database.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_read' },
      });
      const session = await manager.findOne(RefreshSessionEntity, {
        where: { id: sessionId, userId },
        lock: { mode: 'pessimistic_read' },
      });
      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Session is no longer active');
      }
      // Serialize both installation changes and token transfers, including concurrent registrations.
      for (const key of [
        `push-device:${deviceId}`,
        `push-token:${dto.expoPushToken}`,
      ].sort()) {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [key],
        );
      }
      const existing = await manager
        .getRepository(PushDeviceEntity)
        .createQueryBuilder('device')
        .where('device.deviceId = :deviceId OR device.expoPushToken = :token', {
          deviceId,
          token: dto.expoPushToken,
        })
        .orderBy('device.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      if (
        existing.length === 1 &&
        existing[0].deviceId === deviceId &&
        existing[0].expoPushToken === dto.expoPushToken &&
        existing[0].userId === userId &&
        existing[0].sessionId === sessionId
      )
        return;
      // Replacing the immutable registration ID cascades old queued deliveries, never retargeting them.
      if (existing.length)
        await manager.delete(PushDeviceEntity, {
          id: In(existing.map((device) => device.id)),
        });
      await manager.insert(PushDeviceEntity, {
        deviceId,
        expoPushToken: dto.expoPushToken,
        userId,
        sessionId,
      });
    });
    return { deviceId, registered: true as const };
  }

  async unregister(
    deviceId: string,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    await this.database
      .getRepository(PushDeviceEntity)
      .delete({ deviceId: deviceId.toLowerCase(), userId, sessionId });
  }
}
