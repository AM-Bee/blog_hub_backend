import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { BlogEntity } from '../blogs/entities/blog.entity.js';
import { BlogStatus } from '../blogs/enums/blog-status.enum.js';
import { BlogCommentEntity } from '../comments/entities/blog-comment.entity.js';
import { validateDto } from '../common/validation.utils.js';
import { ReactionEntity } from './entities/reaction.entity.js';
import { ToggleReactionDto } from './dto/reaction.dto.js';
import type { ReactionSummary } from './interfaces/reaction.interface.js';

export type ReactionTarget = 'blogId' | 'commentId';

@Injectable()
export class ReactionsRepository {
  constructor(@Inject(DataSource) private readonly database: DataSource) {}

  async get(
    target: ReactionTarget,
    id: string,
    userId?: string,
  ): Promise<ReactionSummary> {
    return this.database.transaction(async (manager) => {
      await this.publishedTarget(manager, target, id, 'pessimistic_read');
      return (await this.summaries(manager, target, [id], userId)).get(id)!;
    });
  }

  async toggle(
    target: ReactionTarget,
    id: string,
    userId: string,
    input: ToggleReactionDto,
  ): Promise<ReactionSummary> {
    const dto = await validateDto(input, ToggleReactionDto);
    return this.database.transaction(async (manager) => {
      // Use the same blog lock as comments, moderation, and deletion to serialize writes.
      await this.publishedTarget(manager, target, id, 'pessimistic_write');
      const where = { [target]: id, userId };
      const existing = await manager.findOneBy(ReactionEntity, where);
      if (existing?.type === dto.type) {
        await manager.delete(ReactionEntity, existing.id);
      } else {
        await manager.save(
          ReactionEntity,
          manager.create(ReactionEntity, {
            ...existing,
            ...where,
            type: dto.type,
          }),
        );
      }
      return (await this.summaries(manager, target, [id], userId)).get(id)!;
    });
  }

  async summaries(
    manager: EntityManager,
    target: ReactionTarget,
    ids: string[],
    userId?: string,
  ): Promise<Map<string, ReactionSummary>> {
    if (!ids.length) return new Map();
    const rows = await manager
      .createQueryBuilder(ReactionEntity, 'reaction')
      .select(`reaction.${target}`, 'id')
      .addSelect(
        `COUNT(*) FILTER (WHERE reaction.type = 'like')::int`,
        'likeCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE reaction.type = 'dislike')::int`,
        'dislikeCount',
      )
      .addSelect(
        'MAX(CASE WHEN reaction.userId = :userId THEN reaction.type END)',
        'myReaction',
      )
      .where(`reaction.${target} IN (:...ids)`, { ids, userId: userId ?? null })
      .groupBy(`reaction.${target}`)
      .getRawMany<ReactionSummary & { id: string }>();
    const counts = new Map(rows.map(({ id, ...summary }) => [id, summary]));
    return new Map(
      ids.map((id) => [
        id,
        counts.get(id) ?? { likeCount: 0, dislikeCount: 0, myReaction: null },
      ]),
    );
  }

  private async publishedTarget(
    manager: EntityManager,
    target: ReactionTarget,
    id: string,
    mode: 'pessimistic_read' | 'pessimistic_write',
  ) {
    let blogId = id;
    if (target === 'commentId') {
      const comment = await manager.findOneBy(BlogCommentEntity, { id });
      if (!comment) throw new NotFoundException('Comment not found');
      blogId = comment.blogId;
    }
    const blog = await manager.findOne(BlogEntity, {
      where: { id: blogId },
      lock: { mode },
    });
    if (!blog || blog.status !== BlogStatus.PUBLISHED)
      throw new NotFoundException('Published blog not found');
    // The comment may have been deleted while waiting for the blog lock.
    if (
      target === 'commentId' &&
      !(await manager.existsBy(BlogCommentEntity, { id, blogId }))
    ) {
      throw new NotFoundException('Comment not found');
    }
  }
}
