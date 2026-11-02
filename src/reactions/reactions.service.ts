import { Inject, Injectable } from '@nestjs/common';
import { ReactionsRepository } from './reactions.repository.js';
import type { ReactionTarget } from './reactions.repository.js';
import { ToggleReactionDto } from './dto/reaction.dto.js';

@Injectable()
export class ReactionsService {
  constructor(
    @Inject(ReactionsRepository)
    private readonly repository: ReactionsRepository,
  ) {}

  get(target: ReactionTarget, id: string, userId?: string) {
    return this.repository.get(target, id, userId);
  }
  toggle(
    target: ReactionTarget,
    id: string,
    userId: string,
    input: ToggleReactionDto,
  ) {
    return this.repository.toggle(target, id, userId, input);
  }
}
