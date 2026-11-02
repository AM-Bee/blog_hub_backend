import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import { BlogPaginationQueryDto } from '../blogs/dto/list-blogs-query.dto.js';
import { CommentContentDto } from './dto/comment.dto.js';
import { CommentsRepository } from './comments.repository.js';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(CommentsRepository) private readonly repository: CommentsRepository,
  ) {}
  list(blogId: string, query: BlogPaginationQueryDto) {
    return this.repository.list(blogId, query);
  }
  replies(id: string, query: BlogPaginationQueryDto) {
    return this.repository.replies(id, query);
  }
  create(blogId: string, user: AuthUser, input: CommentContentDto) {
    return this.repository.create(blogId, user, input);
  }
  reply(id: string, user: AuthUser, input: CommentContentDto) {
    return this.repository.reply(id, user, input);
  }
  update(id: string, user: AuthUser, input: CommentContentDto) {
    return this.repository.update(id, user, input);
  }
  remove(id: string, user: AuthUser) {
    return this.repository.remove(id, user);
  }
}
