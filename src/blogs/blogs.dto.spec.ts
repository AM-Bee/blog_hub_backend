import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateDto } from '../common/validation.utils.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { UpdateBlogDto } from './dto/update-blog.dto.js';
import {
  ListBlogsQueryDto,
  ManageBlogsQueryDto,
} from './dto/list-blogs-query.dto.js';

const body = {
  title: ' Blog title ',
  content: '# Markdown',
  categoryId: randomUUID(),
};

describe('Blog request validation', () => {
  it('requires a category on create and normalizes the title', async () => {
    expect((await validateDto(body, CreateBlogDto)).title).toBe('Blog title');
    await expect(
      validateDto({ title: 'Blog', content: 'Content' }, CreateBlogDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    { ...body, title: '  ' },
    { ...body, title: 'a'.repeat(201) },
    { ...body, content: '  ' },
    { ...body, content: 'a'.repeat(100001) },
    { ...body, categoryId: null },
    { ...body, categoryId: 'invalid' },
    { ...body, tagIds: [randomUUID(), 'invalid'] },
    { ...body, tagIds: ['bad', 'bad'] },
    { ...body, tagIds: Array.from({ length: 11 }, () => randomUUID()) },
    { ...body, tagIds: null },
    { ...body, coverImageUrl: 'javascript:alert(1)' },
    { ...body, coverImageUrl: 'ftp://example.com/x.png' },
    { ...body, status: 'invalid' },
    { ...body, status: null },
    { ...body, authorId: randomUUID() },
    { ...body, slug: 'chosen' },
  ])('rejects invalid or privileged create input: %j', async (input) => {
    await expect(validateDto(input, CreateBlogDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects duplicate tags and accepts explicit cover clearing', async () => {
    const id = randomUUID();
    await expect(
      validateDto({ ...body, tagIds: [id, id] }, CreateBlogDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await validateDto({ coverImageUrl: null }, UpdateBlogDto),
    ).toMatchObject({ coverImageUrl: null });
    expect(
      await validateDto({ title: 'New title' }, UpdateBlogDto),
    ).toMatchObject({ title: 'New title' });
    for (const input of [
      { title: null },
      { content: null },
      { categoryId: null },
      { tagIds: null },
      { status: null },
    ]) {
      await expect(validateDto(input, UpdateBlogDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('defaults pagination and validates page, limit, and management status', async () => {
    expect(await validateDto({}, ListBlogsQueryDto)).toMatchObject({
      page: 1,
      limit: 10,
    });
    expect(
      await validateDto({ page: '2', limit: '20' }, ListBlogsQueryDto),
    ).toMatchObject({ page: 2, limit: 20 });
    for (const input of [
      { page: 0 },
      { limit: 51 },
      { page: 1.5 },
      { limit: -1 },
      { status: 'draft' },
    ]) {
      await expect(
        validateDto(input, ListBlogsQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(
      await validateDto({ status: 'draft' }, ManageBlogsQueryDto),
    ).toMatchObject({ status: 'draft' });
  });
  it('trims search filters without changing case or literal wildcard text', async () => {
    expect(
      await validateDto(
        {
          q: '  Ballet%_  ',
          category: ' dancing ',
          tag: ' ballet ',
          author: ' BEE ',
        },
        ListBlogsQueryDto,
      ),
    ).toMatchObject({
      q: 'Ballet%_',
      category: 'dancing',
      tag: 'ballet',
      author: 'BEE',
      page: 1,
      limit: 10,
    });
  });

  it.each([
    { q: '' },
    { q: '   ' },
    { q: 'a'.repeat(201) },
    { q: ['ballet'] },
    { category: null },
    { category: 'a'.repeat(501) },
    { tag: '  ' },
    { author: 123 },
    { author: 'a'.repeat(101) },
    { author: null },
    { author: { name: 'Bee' } },
  ])('rejects invalid public filters: %j', async (input) => {
    await expect(validateDto(input, ListBlogsQueryDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('keeps public search parameters out of management listings', async () => {
    for (const key of ['q', 'category', 'tag', 'author']) {
      await expect(
        validateDto({ [key]: 'value' }, ManageBlogsQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
