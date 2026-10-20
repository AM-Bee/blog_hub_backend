import { Inject, Injectable } from '@nestjs/common';
import { BlogsRepository } from './blogs.repository.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { UpdateBlogDto } from './dto/update-blog.dto.js';
import { UpdateBlogStatusDto } from './dto/update-blog-status.dto.js';
import {
  ListBlogsQueryDto,
  ManageBlogsQueryDto,
} from './dto/list-blogs-query.dto.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import { ListBlogAuditLogsQueryDto } from './dto/list-blog-audit-logs-query.dto.js';

@Injectable()
export class BlogsService {
  constructor(
    @Inject(BlogsRepository) private readonly repository: BlogsRepository,
  ) {}

  create(dto: CreateBlogDto, user: AuthUser, image?: Express.Multer.File) {
    return this.repository.create(dto, user, image);
  }

  findAll(query: ListBlogsQueryDto) {
    return this.repository.findAll(query);
  }

  findOne(slug: string) {
    return this.repository.findOne(slug);
  }

  findMine(query: ManageBlogsQueryDto, user: AuthUser) {
    return this.repository.findMine(query, user);
  }

  findMyOne(id: string, user: AuthUser) {
    return this.repository.findMyOne(id, user);
  }

  findMyAuditLogs(query: ListBlogAuditLogsQueryDto, user: AuthUser) {
    return this.repository.findMyAuditLogs(query, user);
  }

  findMyAuditLog(id: string, user: AuthUser) {
    return this.repository.findMyAuditLog(id, user);
  }

  findAllForAdmin(query: ManageBlogsQueryDto, user: AuthUser) {
    return this.repository.findAllForAdmin(query, user);
  }

  findOneForAdmin(id: string, user: AuthUser) {
    return this.repository.findOneForAdmin(id, user);
  }

  updateStatusForAdmin(id: string, dto: UpdateBlogStatusDto, user: AuthUser) {
    return this.repository.updateStatusForAdmin(id, dto, user);
  }

  update(
    id: string,
    dto: UpdateBlogDto,
    user: AuthUser,
    image?: Express.Multer.File,
  ) {
    return this.repository.update(id, dto, user, image);
  }

  remove(id: string, user: AuthUser) {
    return this.repository.remove(id, user);
  }
}
