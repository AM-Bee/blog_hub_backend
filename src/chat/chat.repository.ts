import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, QueryFailedError } from 'typeorm';
import type { Repository } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity.js';
import { validateDto } from '../common/validation.utils.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { ConversationEntity } from './entities/conversation.entity.js';
import { MessageEntity } from './entities/message.entity.js';
import type { ConversationResponseDto } from './dto/conversation-response.dto.js';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto.js';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto.js';
import type { ConversationPageResponseDto } from './dto/conversation-page-response.dto.js';
import type { MessagePageResponseDto } from './dto/message-page-response.dto.js';
import type { MessageResponseDto } from './dto/message-response.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { ConversationEventDto } from './dto/conversation-event.dto.js';

@Injectable()
export class ChatRepository {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversations: Repository<ConversationEntity>,
  ) {}

  async findOrCreate(
    userId: string,
    input: CreateConversationDto,
  ): Promise<ConversationEntity> {
    const dto = await validateDto(input, CreateConversationDto);
    const senderId = userId.toLowerCase();
    const recipientId = dto.recipientId.toLowerCase();

    if (senderId === recipientId) {
      throw new BadRequestException(
        'You cannot create a conversation with yourself',
      );
    }

    const recipientExists = await this.conversations.manager
      .getRepository(UserEntity)
      .existsBy({ id: recipientId });

    if (!recipientExists) {
      throw new NotFoundException('Recipient not found');
    }

    const [user1Id, user2Id] = [senderId, recipientId].sort();
    const participants = { user1Id, user2Id };

    const existing = await this.conversations.findOneBy(participants);

    if (existing) {
      return existing;
    }

    const conversation = this.conversations.create(participants);

    try {
      return await this.conversations.save(conversation);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const databaseError = error.driverError as {
          code?: string;
          constraint?: string;
        };

        if (
          databaseError.code === '23505' &&
          databaseError.constraint === 'UQ_chat_conversations_pair'
        ) {
          // Another request created the same conversation first.
          return this.conversations.findOneByOrFail(participants);
        }
      }

      throw error;
    }
  }

  async findForUser(id: string, userId: string): Promise<ConversationEntity> {
    const conversation = await this.conversations.findOneBy({ id });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    this.assertParticipant(conversation, userId);
    return conversation;
  }

  async findMessages(
    id: string,
    userId: string,
    input: ListMessagesQueryDto,
  ): Promise<MessagePageResponseDto> {
    await this.findForUser(id, userId);
    const query = await validateDto(input, ListMessagesQueryDto);
    const [items, total] = await this.conversations.manager
      .getRepository(MessageEntity)
      .findAndCount({
        where: { conversationId: id },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
    return {
      items: items.map((message) => this.messageResponse(message)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async toResponse(
    conversation: ConversationEntity,
    userId: string,
  ): Promise<ConversationResponseDto> {
    const [response] = await this.toResponses([conversation], userId);
    return response;
  }

  async findMine(
    userId: string,
    input: ListConversationsQueryDto,
  ): Promise<ConversationPageResponseDto> {
    const query = await validateDto(input, ListConversationsQueryDto);
    const currentUserId = userId.toLowerCase();
    const [items, total] = await this.conversations.findAndCount({
      where: [{ user1Id: currentUserId }, { user2Id: currentUserId }],
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: await this.toResponses(items, currentUserId),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  private assertParticipant(conversation: ConversationEntity, userId: string) {
    const currentUserId = userId.toLowerCase();
    if (
      conversation.user1Id !== currentUserId &&
      conversation.user2Id !== currentUserId
    ) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }
  }

  private async toResponses(
    conversations: ConversationEntity[],
    userId: string,
  ): Promise<ConversationResponseDto[]> {
    if (!conversations.length) return [];
    const currentUserId = userId.toLowerCase();
    for (const conversation of conversations) {
      this.assertParticipant(conversation, currentUserId);
    }
    const ids = conversations.map((conversation) => conversation.id);
    const otherUserIds = conversations.map((conversation) =>
      conversation.user1Id === currentUserId
        ? conversation.user2Id
        : conversation.user1Id,
    );
    const messages = this.conversations.manager.getRepository(MessageEntity);

    // Three batch queries for the whole page, rather than three per conversation.
    const [users, latestMessages, counts] = await Promise.all([
      this.conversations.manager.getRepository(UserEntity).find({
        where: { id: In(otherUserIds) },
        select: { id: true, displayName: true },
      }),
      messages
        .createQueryBuilder('message')
        .distinctOn(['message.conversationId'])
        .where('message.conversationId IN (:...ids)', { ids })
        .orderBy('message.conversationId', 'ASC')
        .addOrderBy('message.createdAt', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .getMany(),
      messages
        .createQueryBuilder('message')
        .select('message.conversationId', 'conversationId')
        .addSelect('COUNT(*)', 'count')
        .where('message.conversationId IN (:...ids)', { ids })
        .andWhere('message.senderId != :userId', { userId: currentUserId })
        .andWhere('message.isRead = false')
        .groupBy('message.conversationId')
        .getRawMany<{ conversationId: string; count: string }>(),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const messagesByConversation = new Map(
      latestMessages.map((message) => [message.conversationId, message]),
    );
    const unreadByConversation = new Map(
      counts.map((row) => [row.conversationId, Number(row.count)]),
    );
    return conversations.map((conversation, index) => {
      const otherUser = usersById.get(otherUserIds[index]);
      if (!otherUser) throw new NotFoundException('Participant not found');
      const lastMessage = messagesByConversation.get(conversation.id);
      return {
        id: conversation.id,
        otherUser: { id: otherUser.id, displayName: otherUser.displayName },
        lastMessage: lastMessage ? this.messageResponse(lastMessage) : null,
        unreadCount: unreadByConversation.get(conversation.id) ?? 0,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };
    });
  }

  private messageResponse(message: MessageEntity): MessageResponseDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId,
      content: message.content,
      isRead: message.isRead,
      createdAt: message.createdAt,
    };
  }

  async saveMessage(userId: string, input: SendMessageDto) {
    const dto = await validateDto(input, SendMessageDto);
    const senderId = userId.toLowerCase();
    const conversationId = dto.conversationId.toLowerCase();
    const clientMessageId = dto.clientMessageId.toLowerCase();

    return this.conversations.manager.transaction(async (manager) => {
      const conversation = await manager.findOne(ConversationEntity, {
        where: { id: conversationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      this.assertParticipant(conversation, senderId);

      const messages = manager.getRepository(MessageEntity);

      const result = await messages
        .createQueryBuilder()
        .insert()
        .values({
          conversationId,
          senderId,
          clientMessageId,
          content: dto.content,
          createdAt: new Date(),
        })
        .orIgnore()
        .returning('id')
        .execute();

      const insertedRows = result.raw as { id: string }[];
      const created = insertedRows.length > 0;

      const message = await messages.findOneByOrFail({
        senderId,
        clientMessageId,
      });

      // A retry must refer to exactly the same message.
      if (
        message.conversationId !== conversationId ||
        message.content !== dto.content
      ) {
        throw new ConflictException(
          'clientMessageId has already been used for a different message',
        );
      }

      if (created) {
        await manager.update(
          ConversationEntity,
          { id: conversationId },
          { updatedAt: new Date() },
        );
      }

      const recipientId =
        conversation.user1Id === senderId
          ? conversation.user2Id
          : conversation.user1Id;

      return {
        message: this.messageResponse(message),
        recipientId,
        created,
      };
    });
  }

  async markMessagesRead(userId: string, input: ConversationEventDto) {
    const dto = await validateDto(input, ConversationEventDto);
    const readerId = userId.toLowerCase();
    const conversationId = dto.conversationId.toLowerCase();

    return this.conversations.manager.transaction(async (manager) => {
      const conversation = await manager.findOne(ConversationEntity, {
        where: { id: conversationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      this.assertParticipant(conversation, readerId);

      const result = await manager.update(
        MessageEntity,
        {
          conversationId,
          senderId: Not(readerId),
          isRead: false,
        },
        {
          isRead: true,
        },
      );

      const recipientId =
        conversation.user1Id === readerId
          ? conversation.user2Id
          : conversation.user1Id;

      return {
        conversationId,
        readerId,
        recipientId,
        updated: result.affected ?? 0,
      };
    });
  }
}
