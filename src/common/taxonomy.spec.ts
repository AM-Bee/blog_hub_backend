import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { CategoriesService } from '../categories/categories.service.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { CreateCategoryDto } from '../categories/dto/create-category.dto.js';
import { TagsService } from '../tags/tags.service.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { CreateTagDto } from '../tags/dto/create-tag.dto.js';
import { UserRole } from '../users/entities/user.entity.js';
import { normalizeTaxonomyName, taxonomySlug } from './taxonomy.utils.js';

const resources = [
  {
    resource: 'categories',
    Service: CategoriesService,
    Entity: CategoryEntity,
    Dto: CreateCategoryDto,
  },
  {
    resource: 'tags',
    Service: TagsService,
    Entity: TagEntity,
    Dto: CreateTagDto,
  },
];
const author = {
  id: randomUUID(),
  email: 'author@example.com',
  displayName: 'Author',
  role: UserRole.AUTHOR,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const admin = { ...author, id: randomUUID(), role: UserRole.ADMIN };
const duplicate = (constraint: string) =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate'), { code: '23505', constraint }),
  );

describe.each(resources)(
  '$resource service',
  ({ resource, Service, Entity, Dto }) => {
    let service: CategoriesService | TagsService;
    const categoryId = randomUUID();
    const categoryRepository = { existsBy: vi.fn() };
    const nameConstraint =
      resource === 'tags'
        ? 'UQ_tags_category_normalized_name'
        : 'UQ_categories_normalized_name';
    const create = (input: object, user = author) =>
      resource === 'tags'
        ? (service as TagsService).create(
            { ...input, categoryId } as CreateTagDto,
            user,
          )
        : (service as CategoriesService).create(
            input as CreateCategoryDto,
            user,
          );
    const repository = {
      create: vi.fn(),
      save: vi.fn(),
      findOneBy: vi.fn(),
      find: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const existing = () => ({
      id: randomUUID(),
      categoryId,
      name: 'Technology',
      normalizedName: 'technology',
      slug: 'technology',
      createdById: author.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    beforeEach(async () => {
      vi.resetAllMocks();
      categoryRepository.existsBy.mockResolvedValue(true);
      repository.create.mockImplementation((input) => ({ ...input }));
      repository.save.mockImplementation(async (input) => ({
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      }));
      repository.findOneBy.mockResolvedValue(null);
      repository.update.mockResolvedValue({ affected: 1 });
      repository.delete.mockResolvedValue({ affected: 1 });
      const module = await Test.createTestingModule({
        providers: [
          Service,
          { provide: getRepositoryToken(Entity), useValue: repository },
          ...(resource === 'tags'
            ? [
                {
                  provide: getRepositoryToken(CategoryEntity),
                  useValue: categoryRepository,
                },
              ]
            : []),
        ],
      }).compile();
      service = module.get(Service);
    });

    it.each([author, admin])(
      'creates an immediately available entry for role $role using trusted ownership',
      async (user) => {
        const result = await create({ name: '  Web   Development  ' }, user);
        expect(result).toMatchObject({
          name: 'Web Development',
          slug: 'web-development',
          createdById: user.id,
        });
        expect(repository.save.mock.calls[0][0].normalizedName).toBe(
          'web development',
        );
        expect(result).not.toHaveProperty('normalizedName');
      },
    );

    it.each(['Technology', ' technology ', 'TECHNOLOGY'])(
      'rejects an existing name despite case/spacing: %s',
      async (name) => {
        repository.findOneBy.mockResolvedValue(existing());
        await expect(create({ name }, author)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(repository.findOneBy).toHaveBeenCalledWith({
          normalizedName: 'technology',
          ...(resource === 'tags' ? { categoryId } : {}),
        });
        expect(repository.save).not.toHaveBeenCalled();
      },
    );

    it('handles concurrent duplicate creation through the PostgreSQL unique constraint', async () => {
      repository.save.mockRejectedValue(duplicate(nameConstraint));
      await expect(
        create({ name: 'Technology' }, author),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('retries slug collisions for distinct names instead of treating them as duplicate names', async () => {
      repository.save.mockRejectedValueOnce(duplicate(`UQ_${resource}_slug`));
      const result = await create({ name: 'C++' }, author);
      expect(result.slug).toMatch(/^c-[0-9a-f-]{36}$/);
      expect(repository.save).toHaveBeenCalledTimes(2);
    });

    it('returns a conflict after bounded slug collision retries', async () => {
      repository.save.mockRejectedValue(duplicate(`UQ_${resource}_slug`));
      await expect(create({ name: 'C++' }, author)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repository.save).toHaveBeenCalledTimes(3);
    });

    it('regenerates the slug when an author renames their own entry without changing ownership', async () => {
      const record = existing();
      repository.findOneBy.mockResolvedValue(record);
      repository.update.mockImplementation(async (_id, changes) => {
        Object.assign(record, changes);
        return { affected: 1 };
      });
      const result = await service.update(
        record.id,
        { name: '  WEB   Development ' },
        author,
      );
      expect(result).toMatchObject({
        name: 'WEB Development',
        slug: 'web-development',
        createdById: author.id,
      });
      expect(repository.update).toHaveBeenCalledWith(record.id, {
        name: 'WEB Development',
        normalizedName: 'web development',
        slug: 'web-development',
      });
    });

    it('repairs a stale slug even when the submitted name is unchanged', async () => {
      const record = { ...existing(), name: 'java', slug: 'next-js' };
      repository.findOneBy.mockResolvedValue(record);
      repository.update.mockImplementation(async (_id, changes) => {
        Object.assign(record, changes);
        return { affected: 1 };
      });
      expect(
        (await service.update(record.id, { name: 'java' }, author)).slug,
      ).toBe('java');
    });

    it('retries slug collisions during renaming', async () => {
      const record = existing();
      repository.findOneBy.mockResolvedValue(record);
      repository.update.mockRejectedValueOnce(duplicate(`UQ_${resource}_slug`));
      await service.update(record.id, { name: 'C++' }, author);
      expect(repository.update.mock.calls[1][1].slug).toMatch(
        /^c-[0-9a-f-]{36}$/,
      );
    });

    it('rejects edits by an author who does not own the entry', async () => {
      const record = { ...existing(), createdById: admin.id };
      repository.findOneBy.mockResolvedValue(record);
      await expect(
        service.update(record.id, { name: 'New name' }, author),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("allows an admin to edit another user's entry", async () => {
      const record = existing();
      repository.findOneBy.mockResolvedValue(record);
      await service.update(record.id, { name: 'New name' }, admin);
      expect(repository.update).toHaveBeenCalled();
    });

    it('allows retaining the same normalized name but rejects renaming to a duplicate', async () => {
      const record = existing();
      repository.findOneBy.mockResolvedValue(record);
      await service.update(record.id, { name: ' technology ' }, author);
      repository.update.mockRejectedValue(duplicate(nameConstraint));
      await expect(
        service.update(record.id, { name: 'Other name' }, author),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not reinsert an entry deleted during an update', async () => {
      const record = existing();
      repository.findOneBy.mockResolvedValue(record);
      repository.update.mockResolvedValue({ affected: 0 });
      await expect(
        service.update(record.id, { name: 'New name' }, author),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('forbids author deletion even for their own entry, and allows admin deletion', async () => {
      const record = existing();
      await expect(service.remove(record.id, author)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
      await expect(service.remove(record.id, admin)).resolves.toBeUndefined();
      expect(repository.delete).toHaveBeenCalledWith(record.id);
    });

    it('reports missing read/update/delete targets', async () => {
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.update(randomUUID(), { name: 'New name' }, author),
      ).rejects.toBeInstanceOf(NotFoundException);
      repository.delete.mockResolvedValue({ affected: 0 });
      await expect(service.remove(randomUUID(), admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns sorted public entries without normalized names or creator credentials', async () => {
      repository.find.mockResolvedValue([
        {
          ...existing(),
          createdBy: { email: 'private@example.com', passwordHash: 'secret' },
        },
      ]);
      const results = await service.findAll();
      expect(repository.find).toHaveBeenCalledWith({
        order: { normalizedName: 'ASC', id: 'ASC' },
      });
      expect(results[0]).not.toHaveProperty('normalizedName');
      expect(results[0]).not.toHaveProperty('createdBy');
    });

    it('propagates database outages rather than reporting duplicate names', async () => {
      const error = new Error('database unavailable');
      repository.save.mockRejectedValue(error);
      await expect(create({ name: 'Technology' }, author)).rejects.toBe(error);
    });

    it.each([
      { name: '   ' },
      { name: '---' },
      { name: 'a'.repeat(101) },
      { name: 123 },
      {},
      { name: 'Tech', createdById: admin.id },
      { name: 'Tech', role: 'admin' },
      { name: 'Tech', slug: 'chosen' },
    ])(
      'rejects invalid or privileged create/update input: %j',
      async (input) => {
        const record = existing();
        const pipe = new ValidationPipe({
          expectedType: Dto,
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        await expect(
          pipe.transform(input, { type: 'body' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          create(input as { name: string }, author),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.save).not.toHaveBeenCalled();
        repository.findOneBy.mockResolvedValue(record);
        await expect(
          service.update(record.id, input as { name: string }, author),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.update).not.toHaveBeenCalled();
      },
    );
  },
);

describe('taxonomy Unicode names and spacing', () => {
  it('collapses whitespace while preserving meaningful word boundaries', () => {
    expect(normalizeTaxonomyName('  Web\t  Development\n')).toBe(
      'Web Development',
    );
    expect(normalizeTaxonomyName('WebDevelopment')).not.toBe(
      normalizeTaxonomyName('Web Development'),
    );
  });

  it('retains Unicode letters and combining marks in slugs', () => {
    expect(taxonomySlug('နည်းပညာ')).toBe('နည်းပညာ');
    expect(taxonomySlug('Web Development')).toBe('web-development');
  });
});
