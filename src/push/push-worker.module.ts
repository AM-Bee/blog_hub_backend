import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { ConversationEntity } from '../chat/entities/conversation.entity.js';
import { MessageEntity } from '../chat/entities/message.entity.js';
import { PushDeviceEntity } from './entities/push-device.entity.js';
import { PushJobEntity } from './entities/push-job.entity.js';
import { ExpoPushClient } from './expo-push.client.js';
import { PushWorker } from './push.worker.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    TypeOrmModule.forFeature([
      UserEntity,
      RefreshSessionEntity,
      ConversationEntity,
      MessageEntity,
      PushDeviceEntity,
      PushJobEntity,
    ]),
  ],
  providers: [ExpoPushClient, PushWorker],
})
export class PushWorkerModule {}
