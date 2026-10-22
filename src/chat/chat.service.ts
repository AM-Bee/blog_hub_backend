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
  /** Nest supplies the repository that handles chat queries, membership checks, and writes. */
  constructor(
    @Inject(ChatRepository)
    private readonly chatRepository: ChatRepository,
  ) {}

  /** Find or create the conversation, then format it with public participant information. */
  async findOrCreate(userId: string, dto: CreateConversationDto) {
    const conversation = await this.chatRepository.findOrCreate(userId, dto);

    return this.chatRepository.toResponse(conversation, userId);
  }

  /** Ask the repository for this user's paginated conversation summaries. */
  findMine(
    userId: string,
    query: ListConversationsQueryDto,
  ): Promise<ConversationPageResponseDto> {
    return this.chatRepository.findMine(userId, query);
  }

  /** Delegate private message-history retrieval and its membership check to the repository. */
  findMessages(id: string, userId: string, query: ListMessagesQueryDto) {
    return this.chatRepository.findMessages(id, userId, query);
  }

  /** Save a message or retrieve an identical retry; return whether a new row was created. */
  saveMessage(userId: string, dto: SendMessageDto) {
    return this.chatRepository.saveMessage(userId, dto);
  }

  /** Delegate marking messages received by this user as read, leaving their own messages unchanged. */
  markMessagesRead(userId: string, dto: ConversationEventDto) {
    return this.chatRepository.markMessagesRead(userId, dto);
  }

  /** Return a conversation only if this user belongs to it; typing events use this check. */
  findForUser(conversationId: string, userId: string) {
    return this.chatRepository.findForUser(conversationId, userId);
  }
}
