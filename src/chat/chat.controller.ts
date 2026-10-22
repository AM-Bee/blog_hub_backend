import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto.js';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto.js';
import { ConversationPageResponseDto } from './dto/conversation-page-response.dto.js';
import { MessagePageResponseDto } from './dto/message-page-response.dto.js';
import { ChatService } from './chat.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { ConversationResponseDto } from './dto/conversation-response.dto.js';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  /** Nest supplies the service used by these protected REST endpoints. */
  constructor(
    @Inject(ChatService)
    private readonly chatService: ChatService,
  ) {}

  /** Find or start a conversation with the recipient; the sender comes from the signed-in user. */
  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find or create a private conversation' })
  @ApiOkResponse({ type: ConversationResponseDto })
  findOrCreate(
    @Body(dtoValidationPipe(CreateConversationDto))
    dto: CreateConversationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chatService.findOrCreate(request.user.id, dto);
  }

  /** Return one page of the signed-in user's conversations, including latest messages and unread counts. */
  @Get('conversations')
  @ApiOperation({
    summary: 'List your private conversations, most recently updated first',
  })
  @ApiOkResponse({ type: ConversationPageResponseDto })
  findMine(
    @Query(dtoValidationPipe(ListConversationsQueryDto))
    query: ListConversationsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chatService.findMine(request.user.id, query);
  }

  /** Load a page of message history; the repository rejects users outside the conversation. */
  @Get('conversations/:id/messages')
  @ApiOperation({
    summary: 'Read message history, newest first (createdAt then ID)',
  })
  @ApiOkResponse({ type: MessagePageResponseDto })
  findMessages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(dtoValidationPipe(ListMessagesQueryDto)) query: ListMessagesQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chatService.findMessages(id, request.user.id, query);
  }
}
