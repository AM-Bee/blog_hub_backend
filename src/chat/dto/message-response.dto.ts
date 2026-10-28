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

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when the message has been deleted',
  })
  content: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt: Date | null;

  @ApiProperty()
  isRead: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
