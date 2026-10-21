import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'ID of the user you want to chat with',
  })
  @IsUUID()
  recipientId: string;
}
