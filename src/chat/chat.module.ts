import { PushDeviceEntity } from '../push/entities/push-device.entity.js';
import { PushJobEntity } from '../push/entities/push-job.entity.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ConversationEntity } from './entities/conversation.entity.js';
import { MessageEntity } from './entities/message.entity.js';
import { ChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      PushDeviceEntity,
      PushJobEntity,
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatRepository, ChatService, ChatGateway],
})
export class ChatModule {}
