import { Inject, Injectable } from '@nestjs/common';
import { ChatRepository } from './chat.repository.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto.js';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto.js';
import type { ConversationPageResponseDto } from './dto/conversation-page-response.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { ConversationEventDto } from './dto/conversation-event.dto.js';

@Injectable()
export class ChatService {
  constructor(
    @Inject(ChatRepository)
    private readonly chatRepository: ChatRepository,
  ) {}

  async findOrCreate(userId: string, dto: CreateConversationDto) {
    const conversation = await this.chatRepository.findOrCreate(userId, dto);

    return this.chatRepository.toResponse(conversation, userId);
  }

  findMine(
    userId: string,
    query: ListConversationsQueryDto,
  ): Promise<ConversationPageResponseDto> {
    return this.chatRepository.findMine(userId, query);
  }

  findMessages(id: string, userId: string, query: ListMessagesQueryDto) {
    return this.chatRepository.findMessages(id, userId, query);
  }

  saveMessage(userId: string, dto: SendMessageDto) {
    return this.chatRepository.saveMessage(userId, dto);
  }

  markMessagesRead(userId: string, dto: ConversationEventDto) {
    return this.chatRepository.markMessagesRead(userId, dto);
  }

  findForUser(conversationId: string, userId: string) {
    return this.chatRepository.findForUser(conversationId, userId);
  }
}
