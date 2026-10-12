import { BadRequestException } from '@nestjs/common';
import { validateDto } from '../common/validation.utils.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

describe('Admin user input', () => {
  it('defaults pagination and trims search', async () => {
    expect(await validateDto({}, ListUsersQueryDto)).toMatchObject({
      page: 1,
      limit: 10,
    });
    expect(
      await validateDto(
        {
          page: '2',
          limit: '5',
          q: ' Bee ',
          role: 'author',
          status: 'disabled',
        },
        ListUsersQueryDto,
      ),
    ).toMatchObject({
      page: 2,
      limit: 5,
      q: 'Bee',
      role: 'author',
      status: 'disabled',
    });
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { limit: 51 },
    { limit: 'invalid' },
    { role: 'owner' },
    { status: 'deleted' },
    { q: ['a', 'b'] },
    { q: 'a'.repeat(255) },
    { passwordHash: 'anything' },
  ])('rejects invalid list query %j', async (input) => {
    await expect(validateDto(input, ListUsersQueryDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    {},
    { status: null },
    { status: 'deleted' },
    { status: 'disabled', role: 'admin' },
    { status: 'active', password: 'newpassword' },
  ])('rejects invalid status update %j', async (input) => {
    await expect(
      validateDto(input, UpdateUserStatusDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
