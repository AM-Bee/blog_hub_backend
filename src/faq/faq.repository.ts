import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { FaqEntity } from './entities/faq.entity.js';
import { FaqCategoryEntity } from './entities/faq-category.entity.js';
import {
  CreateFaqDto,
  FaqCategoryInputDto,
  FaqSuggestionsQueryDto,
  ListFaqsQueryDto,
  UpdateFaqCategoryDto,
  UpdateFaqDto,
} from './dto/faq-input.dto.js';
import type {
  AdminFaq,
  FaqCategory,
  FaqPage,
  FaqSuggestion,
  PublicFaq,
} from './interfaces/faq.interface.js';
import { validateDto } from '../common/validation.utils.js';

@Injectable()
export class FaqRepository {
  constructor(@Inject(DataSource) private readonly database: DataSource) {}

  async active(): Promise<FaqEntity[]> {
    // shortcut: read the active catalog per ask; add indexed candidate retrieval when it grows large.
    return this.database
      .getRepository(FaqEntity)
      .find({
        where: { isActive: true },
        relations: { category: true },
        order: { displayOrder: 'ASC', id: 'ASC' },
      });
  }

  async suggestions(input: FaqSuggestionsQueryDto): Promise<FaqSuggestion[]> {
    const query = await validateDto(input, FaqSuggestionsQueryDto);
    const items = await this.database
      .getRepository(FaqEntity)
      .find({
        where: {
          isActive: true,
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        },
        relations: { category: true },
        order: { displayOrder: 'ASC', id: 'ASC' },
        take: query.limit,
      });
    return items.map((item) => this.suggestion(item));
  }

  async categories(publicOnly = true): Promise<FaqCategory[]> {
    const query = this.database
      .getRepository(FaqCategoryEntity)
      .createQueryBuilder('category');
    if (publicOnly) {
      query.where(
        (qb) =>
          `EXISTS ${qb.subQuery().select('1').from(FaqEntity, 'faq').where('faq.categoryId = category.id').andWhere('faq.isActive = true').getQuery()}`,
      );
    }
    return query
      .orderBy('category.name', 'ASC')
      .addOrderBy('category.id', 'ASC')
      .getMany();
  }

  async findOne(id: string, publicOnly = true): Promise<PublicFaq | AdminFaq> {
    const item = await this.database
      .getRepository(FaqEntity)
      .findOne({
        where: { id, ...(publicOnly ? { isActive: true } : {}) },
        relations: { category: true },
      });
    if (!item) throw new NotFoundException('FAQ not found');
    return publicOnly
      ? { ...this.suggestion(item), answer: item.answer }
      : this.adminResponse(item);
  }

  async list(input: ListFaqsQueryDto): Promise<FaqPage> {
    const query = await validateDto(input, ListFaqsQueryDto);
    const [items, total] = await this.database
      .getRepository(FaqEntity)
      .findAndCount({
        where: {
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        },
        relations: { category: true },
        order: { displayOrder: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
    return {
      items: items.map((item) => this.adminResponse(item)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async create(input: CreateFaqDto): Promise<AdminFaq | PublicFaq> {
    const dto = await validateDto(input, CreateFaqDto);
    try {
      const item = await this.database.getRepository(FaqEntity).save(dto);
      return this.findOne(item.id, false);
    } catch (error) {
      this.databaseError(error);
    }
  }

  async update(id: string, input: UpdateFaqDto): Promise<AdminFaq | PublicFaq> {
    const dto = await validateDto(input, UpdateFaqDto);
    if (!Object.keys(dto).length)
      throw new BadRequestException('Provide at least one FAQ field');
    try {
      const result = await this.database
        .getRepository(FaqEntity)
        .update(id, dto);
      if (!result.affected) throw new NotFoundException('FAQ not found');
      return this.findOne(id, false);
    } catch (error) {
      this.databaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const result = await this.database.getRepository(FaqEntity).delete(id);
    if (!result.affected) throw new NotFoundException('FAQ not found');
  }

  async createCategory(input: FaqCategoryInputDto): Promise<FaqCategory> {
    const dto = await validateDto(input, FaqCategoryInputDto);
    try {
      return await this.database.getRepository(FaqCategoryEntity).save(dto);
    } catch (error) {
      this.databaseError(error);
    }
  }

  async updateCategory(
    id: string,
    input: UpdateFaqCategoryDto,
  ): Promise<FaqCategory> {
    const dto = await validateDto(input, UpdateFaqCategoryDto);
    if (!Object.keys(dto).length)
      throw new BadRequestException('Provide at least one category field');
    try {
      const repository = this.database.getRepository(FaqCategoryEntity);
      const result = await repository.update(id, dto);
      if (!result.affected)
        throw new NotFoundException('FAQ category not found');
      const item = await repository.findOneBy({ id });
      if (!item) throw new NotFoundException('FAQ category not found');
      return item;
    } catch (error) {
      this.databaseError(error);
    }
  }

  async removeCategory(id: string): Promise<void> {
    try {
      const result = await this.database
        .getRepository(FaqCategoryEntity)
        .delete(id);
      if (!result.affected)
        throw new NotFoundException('FAQ category not found');
    } catch (error) {
      this.databaseError(error);
    }
  }

  suggestion(item: FaqEntity): FaqSuggestion {
    return {
      id: item.id,
      question: item.question,
      category: item.category.name,
    };
  }

  private adminResponse(item: FaqEntity): AdminFaq {
    return {
      ...this.suggestion(item),
      answer: item.answer,
      categoryId: item.categoryId,
      alternativeQuestions: item.alternativeQuestions,
      keywords: item.keywords,
      isActive: item.isActive,
      displayOrder: item.displayOrder,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private databaseError(error: unknown): never {
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as { code?: string }).code;
      if (code === '23505')
        throw new ConflictException('FAQ category name or slug already exists');
      if (code === '23503')
        throw new ConflictException(
          'FAQ category does not exist or still contains FAQs',
        );
    }
    throw error;
  }
}
