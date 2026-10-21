import { ApiProperty } from '@nestjs/swagger';
import { MessageResponseDto } from './message-response.dto.js';

export class MessagePageResponseDto {
  @ApiProperty({ type: [MessageResponseDto] })
  items: MessageResponseDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  totalPages: number;
}
