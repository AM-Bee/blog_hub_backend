import 'reflect-metadata';
import { validateDto } from '../common/validation.utils.js';
import { BlogPaginationQueryDto } from '../blogs/dto/list-blogs-query.dto.js';
import { CommentContentDto } from './dto/comment.dto.js';

it('trims comment text and accepts the maximum length', async () => {
  expect(
    (await validateDto({ content: ' hello ' }, CommentContentDto)).content,
  ).toBe('hello');
  await expect(
    validateDto({ content: 'a'.repeat(2000) }, CommentContentDto),
  ).resolves.toBeDefined();
});
it.each([
  {},
  { content: '' },
  { content: '  \n ' },
  { content: null },
  { content: 12 },
  { content: 'a'.repeat(2001) },
  { content: 'hello', userId: 'another user' },
  { content: 'hello', parentId: 'another comment' },
])('rejects invalid or extra comment input %j', async (input) => {
  await expect(validateDto(input, CommentContentDto)).rejects.toThrow();
});
it('bounds pagination and rejects extra filters', async () => {
  expect(await validateDto({}, BlogPaginationQueryDto)).toMatchObject({
    page: 1,
    limit: 10,
  });
  for (const input of [
    { page: 0 },
    { limit: 51 },
    { page: 1.5 },
    { userId: 'other' },
  ]) {
    await expect(validateDto(input, BlogPaginationQueryDto)).rejects.toThrow();
  }
});
