import { Inject, Injectable } from '@nestjs/common';
import { CategoriesRepository } from './categories.repository.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(CategoriesRepository)
    private readonly repository: CategoriesRepository,
  ) {}

  create(dto: CreateCategoryDto, user: AuthUser) {
    return this.repository.create(dto, user);
  }

  findAll() {
    return this.repository.findAll();
  }

  findOne(slug: string) {
    return this.repository.findOne(slug);
  }

  update(id: string, dto: UpdateCategoryDto, user: AuthUser) {
    return this.repository.update(id, dto, user);
  }

  remove(id: string, user: AuthUser) {
    return this.repository.remove(id, user);
  }
}
