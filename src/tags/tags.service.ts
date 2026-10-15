import { Inject, Injectable } from '@nestjs/common';
import { TagsRepository } from './tags.repository.js';
import { CreateTagDto } from './dto/create-tag.dto.js';
import { UpdateTagDto } from './dto/update-tag.dto.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';

@Injectable()
export class TagsService {
  constructor(
    @Inject(TagsRepository) private readonly repository: TagsRepository,
  ) {}

  create(dto: CreateTagDto, user: AuthUser) {
    return this.repository.create(dto, user);
  }

  findAll(categoryId?: string) {
    return this.repository.findAll(categoryId);
  }

  findOne(slug: string) {
    return this.repository.findOne(slug);
  }

  update(id: string, dto: UpdateTagDto, user: AuthUser) {
    return this.repository.update(id, dto, user);
  }

  remove(id: string, user: AuthUser) {
    return this.repository.remove(id, user);
  }
}
