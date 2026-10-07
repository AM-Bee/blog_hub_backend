import dotenv from 'dotenv';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BlogsService } from './blogs.service.js';
import { BlogEntity, BlogStatus } from './entities/blog.entity.js';
import { BlogTagEntity } from './entities/blog-tag.entity.js';
import { UserEntity, UserRole } from '../users/entities/user.entity.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import type { AuthUser } from '../auth/auth.service.js';

// Opt-in integration checks create and destroy an isolated test schema.
// They never truncate or delete data in the existing application tables.
const enabled = process.env.BLOGHUB_RUN_DB_TESTS === '1';
describe.skipIf(!enabled)('Blogs against isolated PostgreSQL schema', () => {
  const schema = `bloghub_test_${randomUUID().replaceAll('-', '')}`;
  let root: pg.Client;
  let ds: DataSource;
  let service: BlogsService;
  let createdSchema = false;
  let author: AuthUser;
  let other: AuthUser;
  let admin: AuthUser;
  let category: CategoryEntity;
  let tag: TagEntity;

  beforeAll(async () => {
    dotenv.config({ quiet: true });
    const options = {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      connectionTimeoutMillis: 5000,
    };
    root = new pg.Client({ ...options, database: process.env.DB_NAME });
    await root.connect();
    await root.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    ds = new DataSource({
      type: 'postgres',
      host: options.host,
      port: options.port,
      username: options.user,
      password: options.password,
      database: process.env.DB_NAME,
      schema,
      installExtensions: false,
      entities: [
        UserEntity,
        CategoryEntity,
        TagEntity,
        BlogEntity,
        BlogTagEntity,
      ],
      synchronize: true,
    });
    await ds.initialize();
    service = new BlogsService(ds.getRepository(BlogEntity), ds);
    const repo = ds.getRepository(UserEntity);
    author = await repo.save(
      repo.create({
        email: 'author@test.example',
        displayName: 'Author',
        passwordHash: 'test-hash',
        role: UserRole.AUTHOR,
      }),
    );
    other = await repo.save(
      repo.create({
        email: 'other@test.example',
        displayName: 'Other',
        passwordHash: 'test-hash',
        role: UserRole.AUTHOR,
      }),
    );
    admin = await repo.save(
      repo.create({
        email: 'admin@test.example',
        displayName: 'Admin',
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      }),
    );
  }, 30000);

  beforeEach(async () => {
    await ds
      .getRepository(UserEntity)
      .update(author.id, { displayName: 'Author' });
    await ds
      .getRepository(UserEntity)
      .update(other.id, { displayName: 'Other' });
    await ds.query(
      `TRUNCATE TABLE "${schema}".blog_tags, "${schema}".blogs, "${schema}".tags, "${schema}".categories CASCADE`,
    );
    category = await ds.getRepository(CategoryEntity).save({
      name: 'Dancing',
      normalizedName: 'dancing',
      slug: 'dancing',
      createdById: author.id,
    });
    tag = await ds.getRepository(TagEntity).save({
      name: 'Ballet',
      normalizedName: 'ballet',
      slug: 'ballet',
      categoryId: category.id,
      createdById: author.id,
    });
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (createdSchema) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root?.end();
  }, 30000);

  const input = () => ({
    title: 'Ballet basics',
    content: '# Ballet\nHello',
    categoryId: category.id,
    tagIds: [tag.id],
  });

  it('hides drafts publicly, returns safe profiles, and separates author drafts', async () => {
    const blog = await service.create(input(), author);
    expect(blog.status).toBe(BlogStatus.DRAFT);
    expect(blog.author).toEqual({ id: author.id, displayName: 'Author' });
    expect(blog.author).not.toHaveProperty('email');
    await expect(service.findOne(blog.slug)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await service.findAll({ page: 1, limit: 10 })).total).toBe(0);
    expect(
      (await service.findMine({ page: 1, limit: 10 }, author)).items[0].id,
    ).toBe(blog.id);
    expect((await service.findMine({ page: 1, limit: 10 }, other)).total).toBe(
      0,
    );
    await expect(service.findMyOne(blog.id, other)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('enforces ownership and permits admin moderation', async () => {
    const blog = await service.create(input(), author);
    await expect(
      service.update(blog.id, { title: 'Stolen' }, other),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(blog.id, other)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.findAllForAdmin({ page: 1, limit: 10 }, author),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (await service.update(blog.id, { title: 'Moderated' }, admin)).title,
    ).toBe('Moderated');
    expect((await service.findOneForAdmin(blog.id, admin)).title).toBe(
      'Moderated',
    );
    await service.remove(blog.id, admin);
    expect(await ds.getRepository(BlogTagEntity).count()).toBe(0);
    expect(await ds.getRepository(TagEntity).count()).toBe(1);
  });

  it('publishes, unpublishes, and republishes without changing the first publication time or slug', async () => {
    const blog = await service.create(input(), author);
    const published = await service.update(
      blog.id,
      { status: BlogStatus.PUBLISHED },
      author,
    );
    expect((await service.findOne(blog.slug)).publishedAt).toEqual(
      published.publishedAt,
    );
    await service.update(blog.id, { status: BlogStatus.DRAFT }, author);
    await expect(service.findOne(blog.slug)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const republished = await service.update(
      blog.id,
      { status: BlogStatus.PUBLISHED, title: 'New title', coverImageUrl: null },
      author,
    );
    expect(republished.publishedAt).toEqual(published.publishedAt);
    expect(republished.slug).toBe(blog.slug);
  });

  it('resolves duplicate-title slug collisions and paginates without duplicate rows from tag joins', async () => {
    const first = await service.create(
      { ...input(), status: BlogStatus.PUBLISHED },
      author,
    );
    const second = await service.create(
      { ...input(), status: BlogStatus.PUBLISHED },
      author,
    );
    expect(first.slug).not.toBe(second.slug);
    const page = await service.findAll({ page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toHaveProperty('excerpt');
    expect(page.items[0]).not.toHaveProperty('content');
    expect((await service.findAll({ page: 3, limit: 1 })).items).toEqual([]);
  });

  it('rejects nonexistent or cross-category tags and rolls back failed edits', async () => {
    const secondCategory = await ds.getRepository(CategoryEntity).save({
      name: 'Music',
      normalizedName: 'music',
      slug: 'music',
      createdById: author.id,
    });
    const secondTag = await ds.getRepository(TagEntity).save({
      name: 'Piano',
      normalizedName: 'piano',
      slug: 'piano',
      categoryId: secondCategory.id,
      createdById: author.id,
    });
    await expect(
      service.create({ ...input(), tagIds: [secondTag.id] }, author),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await ds.getRepository(BlogEntity).count()).toBe(0);
    const blog = await service.create(input(), author);
    await expect(
      service.update(
        blog.id,
        { title: 'Changed', tagIds: [secondTag.id] },
        author,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.findMyOne(blog.id, author)).title).toBe(
      'Ballet basics',
    );
    await expect(
      service.create({ ...input(), categoryId: randomUUID() }, author),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves published blogs as Uncategorized when a category is deleted, without affecting other categories', async () => {
    const blog = await service.create(
      { ...input(), status: BlogStatus.PUBLISHED },
      author,
    );
    const secondCategory = await ds.getRepository(CategoryEntity).save({
      name: 'Music',
      normalizedName: 'music',
      slug: 'music',
      createdById: author.id,
    });
    const secondTag = await ds.getRepository(TagEntity).save({
      name: 'Piano',
      normalizedName: 'piano',
      slug: 'piano',
      categoryId: secondCategory.id,
      createdById: author.id,
    });
    await ds.getRepository(CategoryEntity).delete(category.id);
    const uncategorized = await service.findOne(blog.slug);
    expect(uncategorized.categoryId).toBeNull();
    expect(uncategorized.category).toBeNull();
    expect(uncategorized.categoryName).toBe('Uncategorized');
    expect(uncategorized.tags).toEqual([]);
    expect(await ds.getRepository(BlogTagEntity).count()).toBe(0);
    expect(
      await ds.getRepository(TagEntity).existsBy({ id: secondTag.id }),
    ).toBe(true);
    expect(
      (await service.update(blog.id, { content: 'Still editable' }, author))
        .content,
    ).toBe('Still editable');
    await expect(
      service.update(blog.id, { tagIds: [secondTag.id] }, author),
    ).rejects.toBeInstanceOf(BadRequestException);
    const assigned = await service.update(
      blog.id,
      { categoryId: secondCategory.id, tagIds: [secondTag.id] },
      author,
    );
    expect(assigned.categoryName).toBe('Music');
    expect(assigned.tags).toHaveLength(1);
  });

  it('clears old tags on category changes and on explicit empty tag lists', async () => {
    const blog = await service.create(input(), author);
    const secondCategory = await ds.getRepository(CategoryEntity).save({
      name: 'Music',
      normalizedName: 'music',
      slug: 'music',
      createdById: author.id,
    });
    expect(
      (await service.update(blog.id, { categoryId: secondCategory.id }, author))
        .tags,
    ).toEqual([]);
    await service.update(
      blog.id,
      { categoryId: category.id, tagIds: [tag.id] },
      author,
    );
    expect(
      (await service.update(blog.id, { tagIds: [] }, author)).tags,
    ).toEqual([]);
    await expect(service.update(blog.id, {}, author)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('combines title/content search, exact taxonomy slugs, partial author names, and pagination without exposing drafts', async () => {
    await ds
      .getRepository(UserEntity)
      .update(author.id, { displayName: 'Bee Admin' });
    await ds
      .getRepository(UserEntity)
      .update(other.id, { displayName: 'Bee Writer' });
    const extraTag = await ds.getRepository(TagEntity).save({
      name: 'Beginner',
      normalizedName: 'beginner',
      slug: 'beginner',
      categoryId: category.id,
      createdById: author.id,
    });
    const first = await service.create(
      {
        ...input(),
        tagIds: [tag.id, extraTag.id],
        status: BlogStatus.PUBLISHED,
      },
      author,
    );
    const second = await service.create(
      {
        ...input(),
        title: 'Practice guide',
        content: 'Learn BALLET today',
        status: BlogStatus.PUBLISHED,
      },
      other,
    );
    await service.create({ ...input(), title: 'Private ballet' }, author);
    await service.create(
      {
        ...input(),
        title: 'Unrelated',
        content: 'A different topic',
        status: BlogStatus.PUBLISHED,
      },
      author,
    );
    const filter = {
      page: 1,
      limit: 1,
      q: '  bAlLeT ',
      category: ' dancing ',
      tag: ' ballet ',
      author: ' BEE ',
    };
    const page = await service.findAll(filter);
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(1);
    const next = await service.findAll({ ...filter, page: 2 });
    expect(new Set([page.items[0].id, next.items[0].id])).toEqual(
      new Set([first.id, second.id]),
    );
    expect(page.items[0].author).not.toHaveProperty('email');
    expect(
      (
        await service.findAll({ ...filter, author: 'admin', limit: 10 })
      ).items.map((b) => b.id),
    ).toEqual([first.id]);
    expect(
      (await service.findAll({ ...filter, tag: 'beginner', limit: 10 }))
        .items[0].tags,
    ).toHaveLength(2);
    for (const mismatch of [
      { category: 'missing' },
      { tag: 'missing' },
      { author: 'missing' },
      { category: 'Dancing' },
      { tag: 'Ballet' },
    ]) {
      const empty = await service.findAll({ ...filter, ...mismatch });
      expect(empty.items).toEqual([]);
      expect(empty.total).toBe(0);
      expect(empty.totalPages).toBe(0);
    }
    expect((await service.findAll({ ...filter, page: 3 })).items).toEqual([]);
  });

  it('treats wildcard characters and SQL-like text literally in title/content and author searches', async () => {
    await ds
      .getRepository(UserEntity)
      .update(author.id, { displayName: 'Bee%_\\Writer' });
    const literal = await service.create(
      { ...input(), title: '100%_\\ballet', status: BlogStatus.PUBLISHED },
      author,
    );
    await service.create(
      { ...input(), title: '100XXballet', status: BlogStatus.PUBLISHED },
      other,
    );
    for (const value of ['%', '_', '\\', '%_\\']) {
      expect(
        (await service.findAll({ page: 1, limit: 10, q: value })).items.map(
          (b) => b.id,
        ),
      ).toEqual([literal.id]);
      expect(
        (
          await service.findAll({ page: 1, limit: 10, author: value })
        ).items.map((b) => b.id),
      ).toEqual([literal.id]);
    }
    expect(
      (await service.findAll({ page: 1, limit: 10, q: "' OR 1=1 --" })).total,
    ).toBe(0);
    expect(
      (await service.findAll({ page: 1, limit: 10, author: "' OR 1=1 --" }))
        .total,
    ).toBe(0);
  });

  it('continues finding Uncategorized posts by content/author while removed taxonomy filters return no matches', async () => {
    const post = await service.create(
      { ...input(), status: BlogStatus.PUBLISHED },
      author,
    );
    await ds.getRepository(CategoryEntity).delete(category.id);
    expect(
      (
        await service.findAll({
          page: 1,
          limit: 10,
          q: 'ballet',
          author: 'author',
        })
      ).items[0].id,
    ).toBe(post.id);
    expect(
      (await service.findAll({ page: 1, limit: 10, category: 'dancing' }))
        .total,
    ).toBe(0);
    expect(
      (await service.findAll({ page: 1, limit: 10, tag: 'ballet' })).total,
    ).toBe(0);
  });
});
