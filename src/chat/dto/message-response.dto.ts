import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  conversationId: string;

  @ApiProperty({ format: 'uuid' })
  senderId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Client-generated ID used to prevent duplicate messages',
  })
  clientMessageId: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  isRead: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
