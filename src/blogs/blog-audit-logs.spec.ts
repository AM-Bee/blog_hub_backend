import { BadRequestException } from '@nestjs/common';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { ListBlogAuditLogsQueryDto } from './dto/list-blog-audit-logs-query.dto.js';

// Invalid pagination must be rejected before PostgreSQL receives an invalid offset.
describe('Personal audit history query validation', () => {
  const pipe = dtoValidationPipe(ListBlogAuditLogsQueryDto);
  it('converts query strings and retains defaults', async () => {
    expect(await pipe.transform({}, { type: 'query' })).toMatchObject({
      page: 1,
      limit: 10,
    });
    expect(
      await pipe.transform({ page: '2', limit: '5' }, { type: 'query' }),
    ).toMatchObject({ page: 2, limit: 5 });
  });
  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1000001' },
    { limit: '0' },
    { limit: '51' },
    { actorId: 'someone-else' },
  ])('rejects invalid pagination or an actor override: %j', async (query) => {
    await expect(
      pipe.transform(query, { type: 'query' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
