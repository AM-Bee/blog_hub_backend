import { ApiProperty } from '@nestjs/swagger';
import { ConversationResponseDto } from './conversation-response.dto.js';
import { APP_FILTER } from '@nestjs/core';

export class ConversationPageResponseDto {
  @ApiProperty({ type: [ConversationResponseDto] })
  items: ConversationResponseDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  totalPages: number;
}

