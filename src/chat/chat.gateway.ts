import {
  BadRequestException,
  HttpException,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { ThrottlerException } from '@nestjs/throttler';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service.js';
import { frontendOrigins } from '../auth/auth.config.js';
import { validateDto } from '../common/validation.utils.js';
import { ChatService } from './chat.service.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { ConversationEventDto } from './dto/conversation-event.dto.js';
import type { ChatAck, ChatErrorCode } from './interface/chat-ack.interface.js';
import type {
  ChatEvent,
  MessageSent,
  ReadReceipt,
  TypingEvent,
} from './interface/chat-event.interface.js';

const RATE_WINDOW_MS = 60_000;
const MESSAGE_LIMIT = 30;
const EVENT_LIMIT = 120;

interface ChatSocketData {
  userId: string;
  accessToken: string;
  expiresAt: number;
}

type ChatSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  ChatSocketData
>;

@WebSocketGateway({
  namespace: '/chat',
  transports: ['websocket'],
  maxHttpBufferSize: 16 * 1024,
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => callback(null, !origin || frontendOrigins().includes(origin)),
    credentials: true,
  },
})
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  private server: Namespace;

  private readonly authTimers = new Map<
    string,
    {
      session: ReturnType<typeof setInterval>;
      expiry: ReturnType<typeof setTimeout>;
    }
  >();
  // Shared across this user's tabs/devices; reconnecting does not reset the window.
  private readonly rateLimits = new Map<
    string,
    { resetAt: number; messages: number; events: number }
  >();
  private rateCleanup?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ChatService) private readonly chatService: ChatService,
  ) {}

  afterInit(server: Namespace) {
    this.rateCleanup = setInterval(() => {
      for (const [userId, bucket] of this.rateLimits) {
        if (bucket.resetAt <= Date.now()) this.rateLimits.delete(userId);
      }
    }, RATE_WINDOW_MS);
    this.rateCleanup.unref();

    server.use(async (socket: ChatSocket, next) => {
      try {
        const origin = socket.handshake.headers.origin;
        // CORS alone does not protect WebSocket upgrades; check the handshake too.
        if (origin && !frontendOrigins().includes(origin)) {
          return next(new Error('Origin is not allowed'));
        }
        const accessToken: unknown = socket.handshake.auth.accessToken;
        if (typeof accessToken !== 'string' || !accessToken) {
          return next(new Error('Authentication required'));
        }
        const user = await this.authService.authenticate(accessToken);
        // Read expiry only AFTER AuthService has verified this JWT's signature and claims.
        const payload = JSON.parse(
          Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
        ) as { exp?: unknown };
        if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
          return next(new Error('Authentication failed'));
        }
        socket.data.userId = user.id;
        socket.data.accessToken = accessToken;
        socket.data.expiresAt = payload.exp * 1000;
        next();
      } catch {
        next(new Error('Authentication failed'));
      }
    });
  }

  async handleConnection(socket: ChatSocket) {
    if (socket.data.expiresAt <= Date.now()) {
      socket.disconnect(true);
      return;
    }
    await socket.join(`user:${socket.data.userId}`);
    if (!socket.connected) return;

    let checking = false;
    const session = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.authenticateSocket(socket)
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    }, 30_000);
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expiresAt - Date.now()),
    );
    session.unref();
    expiry.unref();
    this.authTimers.set(socket.id, { session, expiry });
  }

  handleDisconnect(socket: ChatSocket) {
    const timers = this.authTimers.get(socket.id);
    if (timers) {
      clearInterval(timers.session);
      clearTimeout(timers.expiry);
      this.authTimers.delete(socket.id);
    }
  }

  onModuleDestroy() {
    for (const timers of this.authTimers.values()) {
      clearInterval(timers.session);
      clearTimeout(timers.expiry);
    }
    this.authTimers.clear();
    if (this.rateCleanup) clearInterval(this.rateCleanup);
    this.rateLimits.clear();
  }

  @SubscribeMessage('message:send')
  async sendMessage(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() input: unknown,
  ): Promise<ChatAck<MessageSent>> {
    try {
      this.checkRateLimit(socket.data.userId, true);
      const userId = await this.authenticateSocket(socket);
      const dto = await validateDto(this.objectPayload(input), SendMessageDto);
      const result = await this.chatService.saveMessage(userId, dto);
      if (result.created) {
        await this.emitToUser(result.recipientId, {
          event: 'message:new',
          data: result.message,
        });
      }
      return {
        ok: true,
        data: { message: result.message, created: result.created },
      };
    } catch (error) {
      return this.errorAck(error);
    }
  }

  @SubscribeMessage('message:read')
  async readMessages(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() input: unknown,
  ): Promise<ChatAck<ReadReceipt>> {
    try {
      this.checkRateLimit(socket.data.userId);
      const userId = await this.authenticateSocket(socket);
      const dto = await validateDto(
        this.objectPayload(input),
        ConversationEventDto,
      );
      const result = await this.chatService.markMessagesRead(userId, dto);
      const receipt: ReadReceipt = {
        conversationId: result.conversationId,
        readerId: result.readerId,
        updated: result.updated,
      };
      if (result.updated > 0) {
        await this.emitToUser(result.recipientId, {
          event: 'message:read',
          data: receipt,
        });
      }
      return { ok: true, data: receipt };
    } catch (error) {
      return this.errorAck(error);
    }
  }

  @SubscribeMessage('typing:start')
  typingStart(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() input: unknown,
  ) {
    return this.typing(socket, input, 'typing:start');
  }

  @SubscribeMessage('typing:stop')
  typingStop(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() input: unknown,
  ) {
    return this.typing(socket, input, 'typing:stop');
  }

  private async typing(
    socket: ChatSocket,
    input: unknown,
    event: 'typing:start' | 'typing:stop',
  ): Promise<ChatAck<TypingEvent>> {
    try {
      this.checkRateLimit(socket.data.userId);
      const userId = await this.authenticateSocket(socket);
      const dto = await validateDto(
        this.objectPayload(input),
        ConversationEventDto,
      );
      const conversation = await this.chatService.findForUser(
        dto.conversationId,
        userId,
      );
      const recipientId =
        conversation.user1Id === userId
          ? conversation.user2Id
          : conversation.user1Id;
      const data = { conversationId: conversation.id, userId };
      await this.emitToUser(recipientId, { event, data });
      return { ok: true, data };
    } catch (error) {
      return this.errorAck(error);
    }
  }

  private async authenticateSocket(socket: ChatSocket): Promise<string> {
    try {
      if (!socket.connected || socket.data.expiresAt <= Date.now()) {
        throw new UnauthorizedException();
      }
      const user = await this.authService.authenticate(socket.data.accessToken);
      // Authentication includes database queries; expiry or disconnect can happen while awaiting them.
      if (
        !socket.connected ||
        socket.data.expiresAt <= Date.now() ||
        user.id !== socket.data.userId
      ) {
        throw new UnauthorizedException();
      }
      return user.id;
    } catch {
      socket.disconnect(true);
      throw new UnauthorizedException(
        'Authentication is no longer valid. Please reconnect.',
      );
    }
  }

  private async emitToUser(userId: string, notification: ChatEvent) {
    const ids = this.server.adapter.rooms.get(`user:${userId}`);
    if (!ids) return;
    await Promise.all(
      [...ids].map(async (id) => {
        const target = this.server.sockets.get(id) as ChatSocket | undefined;
        if (!target) return;
        try {
          // Do not deliver private events to an expired/revoked recipient between timer checks.
          await this.authenticateSocket(target);
          if (target.connected)
            target.emit(notification.event, notification.data);
        } catch {
          // Authentication failure already disconnects this recipient. The saved message remains in history.
        }
      }),
    );
  }

  private checkRateLimit(userId: string, sending = false) {
    let bucket = this.rateLimits.get(userId);
    if (!bucket || bucket.resetAt <= Date.now()) {
      bucket = { resetAt: Date.now() + RATE_WINDOW_MS, messages: 0, events: 0 };
      this.rateLimits.set(userId, bucket);
    }
    if (
      bucket.events >= EVENT_LIMIT ||
      (sending && bucket.messages >= MESSAGE_LIMIT)
    ) {
      throw new ThrottlerException(
        'Chat rate limit exceeded. Please try again later.',
      );
    }
    bucket.events++;
    if (sending) bucket.messages++;
  }

  private objectPayload(input: unknown): object {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Payload must be a JSON object');
    }
    return input;
  }

  private errorAck(error: unknown): ChatAck<never> {
    if (!(error instanceof HttpException) || error.getStatus() >= 500) {
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to process the request',
        },
      };
    }
    const codes: Partial<Record<number, ChatErrorCode>> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      429: 'RATE_LIMITED',
    };
    const response = error.getResponse();
    const detail =
      typeof response === 'string'
        ? response
        : 'message' in response
          ? response.message
          : error.message;
    const message = Array.isArray(detail)
      ? detail.filter((item) => typeof item === 'string').join('; ')
      : typeof detail === 'string'
        ? detail
        : 'Request failed';
    return {
      ok: false,
      error: { code: codes[error.getStatus()] ?? 'BAD_REQUEST', message },
    };
  }
}
