import { BadRequestException } from '@nestjs/common';
import { validateDto } from '../common/validation.utils.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ChangePasswordDto } from '../auth/dto/change-password.dto.js';

describe('Account DTO validation', () => {
  it('normalizes profile fields and preserves password whitespace', async () => {
    expect(
      await validateDto(
        {
          displayName: ' Bee ',
          email: ' BEE@Example.com ',
          currentPassword: ' password ',
        },
        UpdateUserDto,
      ),
    ).toMatchObject({
      displayName: 'Bee',
      email: 'bee@example.com',
      currentPassword: ' password ',
    });
  });
  it.each([
    { displayName: ' ' },
    { email: 'invalid' },
    { displayName: null },
    { email: null },
    { currentPassword: null },
    { role: 'admin' },
    { id: 'other-user' },
    { password: 'password123' },
    { passwordHash: 'hash' },
  ])('rejects invalid or privileged profile input: %j', async (input) => {
    await expect(validateDto(input, UpdateUserDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it.each([
    { currentPassword: 'old' },
    { newPassword: 'new-password' },
    { currentPassword: 'old', newPassword: 'short' },
    { currentPassword: 'old', newPassword: '😀'.repeat(19) },
    { currentPassword: 'old', newPassword: 'a'.repeat(73) },
    { currentPassword: 'old', newPassword: null },
    { currentPassword: 'old', newPassword: 'new-password', userId: 'other' },
  ])('rejects invalid password change input: %j', async (input) => {
    await expect(validateDto(input, ChangePasswordDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
