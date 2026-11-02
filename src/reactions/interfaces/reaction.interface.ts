import type { ReactionType } from '../enums/reaction-type.enum.js';

export interface ReactionSummary {
  likeCount: number;
  dislikeCount: number;
  myReaction: ReactionType | null;
}
