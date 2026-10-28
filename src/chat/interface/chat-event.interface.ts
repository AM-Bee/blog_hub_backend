import type { MessageResponseDto } from '../dto/message-response.dto.js';

export interface MessageSent {
  message: MessageResponseDto;
  created: boolean;
}

export interface MessageDeleted {
  messageId: string;
  conversationId: string;
  deletedAt: Date;
}

export interface ReadReceipt {
  conversationId: string;
  readerId: string;
  updated: number;
}

export interface TypingEvent {
  conversationId: string;
  userId: string;
}

export type ChatEvent =
  | { event: 'message:new'; data: MessageResponseDto }
  | { event: 'message:read'; data: ReadReceipt }
  | { event: 'message:deleted'; data: MessageDeleted }
  | { event: 'typing:start' | 'typing:stop'; data: TypingEvent };
