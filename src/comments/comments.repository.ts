import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { BlogEntity } from '../blogs/entities/blog.entity.js';
import { BlogStatus } from '../blogs/enums/blog-status.enum.js';
import { BlogPaginationQueryDto } from '../blogs/dto/list-blogs-query.dto.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { validateDto } from '../common/validation.utils.js';
import { BlogCommentEntity } from './entities/blog-comment.entity.js';
import { CommentContentDto } from './dto/comment.dto.js';
import type {
  CommentPage,
  BlogComment,
} from './interfaces/comment.interface.js';

@Injectable()
export class CommentsRepository {
  constructor(@Inject(DataSource) private readonly database: DataSource) {}

  async list(
    blogId: string,
    input: BlogPaginationQueryDto,
    parentId: string | null = null,
  ): Promise<CommentPage> {
    const query = await validateDto(input, BlogPaginationQueryDto);
    return this.database.transaction(async (manager) => {
      await this.publishedBlog(manager, blogId, 'pessimistic_read');
      if (parentId) await this.rootComment(manager, parentId);
      const [items, total] = await manager.findAndCount(BlogCommentEntity, {
        where: { blogId, parentId: parentId ?? IsNull() },
        relations: { author: true },
        order: { createdAt: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        items: items.map((item) => this.response(item)),
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    });
  }

  async replies(id: string, query: BlogPaginationQueryDto) {
    const comment = await this.findComment(this.database.manager, id);
    return this.list(comment.blogId, query, id);
  }

  async create(
    blogId: string,
    user: AuthUser,
    input: CommentContentDto,
    parentId: string | null = null,
  ): Promise<BlogComment> {
    const dto = await validateDto(input, CommentContentDto);
    return this.database.transaction(async (manager) => {
      // All comment writes lock the blog first, matching blog moderation/deletion.
      await this.publishedBlog(manager, blogId, 'pessimistic_write');
      if (parentId) {
        const parent = await this.rootComment(manager, parentId);
        if (parent.blogId !== blogId) {
          throw new BadRequestException('Reply must belong to the same blog');
        }
      }
      const item = await manager.save(
        BlogCommentEntity,
        manager.create(BlogCommentEntity, {
          blogId,
          userId: user.id,
          parentId,
          content: dto.content,
        }),
      );
      return this.response(item, user);
    });
  }

  async reply(id: string, user: AuthUser, input: CommentContentDto) {
    const parent = await this.findComment(this.database.manager, id);
    return this.create(parent.blogId, user, input, id);
  }

  async update(
    id: string,
    user: AuthUser,
    input: CommentContentDto,
  ): Promise<BlogComment> {
    const dto = await validateDto(input, CommentContentDto);
    const original = await this.findComment(this.database.manager, id);
    return this.database.transaction(async (manager) => {
      await this.publishedBlog(manager, original.blogId, 'pessimistic_write');
      const item = await this.findComment(manager, id);
      if (item.userId !== user.id) {
        throw new ForbiddenException('You can only edit your own comments');
      }
      item.content = dto.content;
      return this.response(await manager.save(BlogCommentEntity, item));
    });
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const original = await this.findComment(this.database.manager, id);
    await this.database.transaction(async (manager) => {
      await this.publishedBlog(manager, original.blogId, 'pessimistic_write');
      const item = await this.findComment(manager, id);
      if (item.userId !== user.id && user.role !== UserRole.ADMIN) {
        throw new ForbiddenException('You can only delete your own comments');
      }
      await manager.delete(BlogCommentEntity, id);
    });
  }

  private async publishedBlog(
    manager: EntityManager,
    id: string,
    mode: 'pessimistic_read' | 'pessimistic_write',
  ) {
    const blog = await manager.findOne(BlogEntity, {
      where: { id },
      lock: { mode },
    });
    if (!blog || blog.status !== BlogStatus.PUBLISHED) {
      throw new NotFoundException('Published blog not found');
    }
    return blog;
  }

  private async findComment(manager: EntityManager, id: string) {
    const item = await manager.findOne(BlogCommentEntity, {
      where: { id },
      relations: { author: true },
    });
    if (!item) throw new NotFoundException('Comment not found');
    return item;
  }

  private async rootComment(manager: EntityManager, id: string) {
    const item = await this.findComment(manager, id);
    if (item.parentId !== null) {
      throw new BadRequestException(
        'Replies are only allowed on top-level comments',
      );
    }
    return item;
  }

  private response(
    item: BlogCommentEntity,
    author: { id: string; displayName: string } = item.author,
  ): BlogComment {
    return {
      id: item.id,
      blogId: item.blogId,
      parentId: item.parentId,
      author: { id: author.id, displayName: author.displayName },
      content: item.content,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
