import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ConversationEventDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  conversationId: string;
}
