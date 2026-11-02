import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ReactionType } from '../enums/reaction-type.enum.js';
import type { ReactionSummary } from '../interfaces/reaction.interface.js';

export class ToggleReactionDto {
  @ApiProperty({ enum: ReactionType })
  @IsEnum(ReactionType)
  type: ReactionType;
}

export class ReactionSummaryDto implements ReactionSummary {
  @ApiProperty({ minimum: 0 }) likeCount: number;
  @ApiProperty({ minimum: 0 }) dislikeCount: number;
  @ApiProperty({ enum: ReactionType, nullable: true })
  myReaction: ReactionType | null;
}
