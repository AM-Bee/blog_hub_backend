import { CategoriesRepository } from '../categories/categories.repository.js';
import { TagsRepository } from './tags.repository.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { TagsService } from './tags.service.js';
import { TagEntity } from './entities/tag.entity.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { CategoriesService } from '../categories/categories.service.js';
import { CreateTagDto } from './dto/create-tag.dto.js';
import { UpdateTagDto } from './dto/update-tag.dto.js';
import { ListTagsQueryDto } from './dto/list-tags-query.dto.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UserStatus } from '../users/enums/user-status.enum.js';

describe('Tags belong to categories', () => {
  let service: TagsService;
  const author = {
    id: randomUUID(),
    displayName: 'Author',
    email: 'author@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const dancing = randomUUID();
  const performing = randomUUID();
  const categoryRepository = { existsBy: vi.fn() };
  const records: Array<Partial<TagEntity>> = [];
  const repository = {
    findOneBy: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
    find: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    records.length = 0;
    categoryRepository.existsBy.mockResolvedValue(true);
    repository.findOneBy.mockImplementation(
      async (criteria) =>
        records.find(
          (record) =>
            record.normalizedName === criteria.normalizedName &&
            record.categoryId === criteria.categoryId,
        ) ?? null,
    );
    repository.create.mockImplementation((input) => ({ ...input }));
    repository.save.mockImplementation(async (input) => {
      const record = {
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      };
      records.push(record);
      return record;
    });
    repository.find.mockImplementation(async (options) =>
      records.filter(
        (record) =>
          !options.where || record.categoryId === options.where.categoryId,
      ),
    );
    const module = await Test.createTestingModule({
      providers: [
        TagsService,
        TagsRepository,
        { provide: getRepositoryToken(TagEntity), useValue: repository },
        {
          provide: getRepositoryToken(CategoryEntity),
          useValue: categoryRepository,
        },
      ],
    }).compile();
    service = module.get(TagsService);
  });

  it('allows Ballet in different categories but rejects another ballet in the same category', async () => {
    expect(
      (await service.create({ name: 'Ballet', categoryId: dancing }, author))
        .categoryId,
    ).toBe(dancing);
    expect(
      (
        await service.create(
          { name: ' ballet ', categoryId: performing },
          author,
        )
      ).categoryId,
    ).toBe(performing);
    await expect(
      service.create({ name: 'BALLET', categoryId: dancing }, author),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects missing/invalid/nonexistent parent categories', async () => {
    await expect(
      service.create({ name: 'Ballet' } as CreateTagDto, author),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ name: 'Ballet', categoryId: 'invalid' }, author),
    ).rejects.toBeInstanceOf(BadRequestException);
    categoryRepository.existsBy.mockResolvedValue(false);
    await expect(
      service.create({ name: 'Ballet', categoryId: dancing }, author),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('handles a category deleted between validation and saving', async () => {
    repository.save.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('foreign key'), {
          code: '23503',
          constraint: 'FK_tags_category',
        }),
      ),
    );
    await expect(
      service.create({ name: 'Ballet', categoryId: dancing }, author),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters public tags by category without exposing internal fields', async () => {
    await service.create({ name: 'Ballet', categoryId: dancing }, author);
    await service.create({ name: 'Painting', categoryId: performing }, author);
    expect((await service.findAll(dancing)).map((tag) => tag.name)).toEqual([
      'Ballet',
    ]);
    expect(repository.find).toHaveBeenCalledWith({
      where: { categoryId: dancing },
      order: { normalizedName: 'ASC', id: 'ASC' },
    });
    categoryRepository.existsBy.mockResolvedValue(false);
    await expect(service.findAll(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('validates filters and does not allow reparenting through a rename request', async () => {
    const options = {
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    };
    const queryPipe = new ValidationPipe({
      ...options,
      expectedType: ListTagsQueryDto,
    });
    await expect(
      queryPipe.transform({ categoryId: 'invalid' }, { type: 'query' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await queryPipe.transform({ categoryId: dancing }, { type: 'query' }),
    ).toMatchObject({ categoryId: dancing });
    const updatePipe = new ValidationPipe({
      ...options,
      expectedType: UpdateTagDto,
    });
    await expect(
      updatePipe.transform(
        { name: 'Ballet', categoryId: performing },
        { type: 'body' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Category deletion with child tags', () => {
  it('propagates database failures instead of reporting successful deletion', async () => {
    const error = new Error('Database unavailable');
    const repository = { delete: vi.fn().mockRejectedValue(error) };
    const module = await Test.createTestingModule({
      providers: [
        CategoriesService,
        CategoriesRepository,
        { provide: getRepositoryToken(CategoryEntity), useValue: repository },
      ],
    }).compile();
    const admin = {
      id: randomUUID(),
      displayName: 'Admin',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await expect(
      module.get(CategoriesService).remove(randomUUID(), admin),
    ).rejects.toBe(error);
  });
});
