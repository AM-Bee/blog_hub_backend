import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  conversationId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Generate once per message and reuse when retrying',
  })
  @IsUUID()
  clientMessageId: string;

  @ApiProperty({
    example: 'Hello!',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/u, {
    message: 'content must contain at least one non-whitespace character',
  })
  content: string;
}
