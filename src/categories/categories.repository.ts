import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import type { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { CategoryEntity } from './entities/category.entity.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import type { Category } from './interfaces/category.interface.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { taxonomySlug } from '../common/taxonomy.utils.js';
import { validateDto } from '../common/validation.utils.js';

@Injectable()
export class CategoriesRepository {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  async create(
    createCategoryDto: CreateCategoryDto,
    user: AuthUser,
  ): Promise<Category> {
    this.assertWriter(user);
    const { name } = await validateDto(createCategoryDto, CreateCategoryDto);
    const normalizedName = name.toLowerCase();
    const existing = await this.categoryRepository.findOneBy({
      normalizedName,
    });
    if (existing) {
      throw new ConflictException('Category name already exists');
    }

    const baseSlug = taxonomySlug(name);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 3; attempt++) {
      const category = this.categoryRepository.create({
        name,
        normalizedName,
        slug,
        createdById: user.id,
      });
      try {
        return this.toResponse(await this.categoryRepository.save(category));
      } catch (error) {
        const constraint = this.uniqueConstraint(error);
        if (constraint === 'UQ_categories_normalized_name') {
          throw new ConflictException('Category name already exists');
        }
        if (constraint !== 'UQ_categories_slug') {
          throw error;
        }
        slug = `${baseSlug}-${randomUUID()}`;
      }
    }
    throw new ConflictException('Unable to generate a unique category slug');
  }

  async findAll(): Promise<Category[]> {
    const categories = await this.categoryRepository.find({
      order: { normalizedName: 'ASC', id: 'ASC' },
    });
    return categories.map((category) => this.toResponse(category));
  }

  async findOne(slug: string): Promise<Category> {
    const category = await this.categoryRepository.findOneBy({ slug });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return this.toResponse(category);
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    user: AuthUser,
  ): Promise<Category> {
    this.assertWriter(user);
    const category = await this.findById(id);
    if (user.role !== UserRole.ADMIN && category.createdById !== user.id) {
      throw new ForbiddenException('You can only edit categories you created');
    }
    const { name } = await validateDto(updateCategoryDto, UpdateCategoryDto);
    const normalizedName = name.toLowerCase();
    const baseSlug = taxonomySlug(name);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.categoryRepository.update(id, {
          name,
          normalizedName,
          slug,
        });
        if (!result.affected) {
          throw new NotFoundException('Category not found');
        }
        return this.toResponse(await this.findById(id));
      } catch (error) {
        const constraint = this.uniqueConstraint(error);
        if (constraint === 'UQ_categories_normalized_name') {
          throw new ConflictException('Category name already exists');
        }
        if (constraint !== 'UQ_categories_slug') {
          throw error;
        }
        slug = `${baseSlug}-${randomUUID()}`;
      }
    }
    throw new ConflictException('Unable to generate a unique category slug');
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete categories');
    }
    // PostgreSQL deletes child tags atomically through ON DELETE CASCADE.
    const result = await this.categoryRepository.delete(id);
    if (!result.affected) {
      throw new NotFoundException('Category not found');
    }
  }

  private async findById(id: string): Promise<CategoryEntity> {
    const category = await this.categoryRepository.findOneBy({ id });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  private assertWriter(user: AuthUser): void {
    if (![UserRole.AUTHOR, UserRole.ADMIN].includes(user.role)) {
      throw new ForbiddenException('Author or admin access is required');
    }
  }

  private uniqueConstraint(error: unknown): string | undefined {
    if (!(error instanceof QueryFailedError)) {
      return undefined;
    }
    const databaseError = error.driverError as {
      code?: string;
      constraint?: string;
    };
    return databaseError.code === '23505'
      ? databaseError.constraint
      : undefined;
  }

  private toResponse(category: CategoryEntity): Category {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      createdById: category.createdById,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
