import { ApiProperty } from '@nestjs/swagger';
import { MessageResponseDto } from './message-response.dto.js';

export class ChatUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  displayName: string;
}

export class ConversationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: ChatUserDto })
  otherUser: ChatUserDto;

  @ApiProperty({ type: MessageResponseDto, nullable: true })
  lastMessage: MessageResponseDto | null;

  @ApiProperty()
  unreadCount: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}
