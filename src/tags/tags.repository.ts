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
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from './entities/tag.entity.js';
import { CreateTagDto } from './dto/create-tag.dto.js';
import { UpdateTagDto } from './dto/update-tag.dto.js';
import type { Tag } from './interfaces/tag.interface.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { taxonomySlug } from '../common/taxonomy.utils.js';
import { validateDto } from '../common/validation.utils.js';

@Injectable()
export class TagsRepository {
  constructor(
    @InjectRepository(TagEntity)
    private readonly tagRepository: Repository<TagEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  async create(createTagDto: CreateTagDto, user: AuthUser): Promise<Tag> {
    this.assertWriter(user);
    const dto = await validateDto(createTagDto, CreateTagDto);
    const name = dto.name;
    const categoryId = dto.categoryId;
    if (!(await this.categoryRepository.existsBy({ id: categoryId }))) {
      throw new NotFoundException('Category not found');
    }
    const normalizedName = name.toLowerCase();
    const existing = await this.tagRepository.findOneBy({
      normalizedName,
      categoryId,
    });
    if (existing) {
      throw new ConflictException('Tag name already exists in this category');
    }

    const baseSlug = taxonomySlug(name);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 3; attempt++) {
      const tag = this.tagRepository.create({
        name,
        categoryId,
        normalizedName,
        slug,
        createdById: user.id,
      });
      try {
        return this.toResponse(await this.tagRepository.save(tag));
      } catch (error) {
        if (error instanceof QueryFailedError) {
          const databaseError = error.driverError as {
            code?: string;
            constraint?: string;
          };
          if (
            databaseError.code === '23503' &&
            databaseError.constraint === 'FK_tags_category'
          ) {
            throw new NotFoundException('Category not found');
          }
        }
        const constraint = this.uniqueConstraint(error);
        if (constraint === 'UQ_tags_category_normalized_name') {
          throw new ConflictException(
            'Tag name already exists in this category',
          );
        }
        if (constraint !== 'UQ_tags_slug') {
          throw error;
        }
        slug = `${baseSlug}-${randomUUID()}`;
      }
    }
    throw new ConflictException('Unable to generate a unique tag slug');
  }

  async findAll(categoryId?: string): Promise<Tag[]> {
    if (
      categoryId &&
      !(await this.categoryRepository.existsBy({ id: categoryId }))
    ) {
      throw new NotFoundException('Category not found');
    }
    const tags = await this.tagRepository.find({
      ...(categoryId ? { where: { categoryId } } : {}),
      order: { normalizedName: 'ASC', id: 'ASC' },
    });
    return tags.map((tag) => this.toResponse(tag));
  }

  async findOne(slug: string): Promise<Tag> {
    const tag = await this.tagRepository.findOneBy({ slug });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return this.toResponse(tag);
  }

  async update(
    id: string,
    updateTagDto: UpdateTagDto,
    user: AuthUser,
  ): Promise<Tag> {
    this.assertWriter(user);
    const tag = await this.findById(id);
    if (user.role !== UserRole.ADMIN && tag.createdById !== user.id) {
      throw new ForbiddenException('You can only edit tags you created');
    }
    const { name } = await validateDto(updateTagDto, UpdateTagDto);
    const normalizedName = name.toLowerCase();
    const baseSlug = taxonomySlug(name);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.tagRepository.update(id, {
          name,
          normalizedName,
          slug,
        });
        if (!result.affected) {
          throw new NotFoundException('Tag not found');
        }
        return this.toResponse(await this.findById(id));
      } catch (error) {
        const constraint = this.uniqueConstraint(error);
        if (constraint === 'UQ_tags_category_normalized_name') {
          throw new ConflictException(
            'Tag name already exists in this category',
          );
        }
        if (constraint !== 'UQ_tags_slug') {
          throw error;
        }
        slug = `${baseSlug}-${randomUUID()}`;
      }
    }
    throw new ConflictException('Unable to generate a unique tag slug');
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete tags');
    }
    const result = await this.tagRepository.delete(id);
    if (!result.affected) {
      throw new NotFoundException('Tag not found');
    }
  }

  private async findById(id: string): Promise<TagEntity> {
    const tag = await this.tagRepository.findOneBy({ id });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
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

  private toResponse(tag: TagEntity): Tag {
    return {
      id: tag.id,
      categoryId: tag.categoryId,
      name: tag.name,
      slug: tag.slug,
      createdById: tag.createdById,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    };
  }
}
