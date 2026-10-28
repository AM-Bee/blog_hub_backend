import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DeleteMessageDto {
  @ApiProperty({
    format: 'uuid',
    description: 'ID of your own message to delete for everyone',
  })
  @IsUUID()
  messageId: string;
}
