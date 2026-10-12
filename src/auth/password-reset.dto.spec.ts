import { BadRequestException } from '@nestjs/common';
import { validateDto } from '../common/validation.utils.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

describe('Password reset validation', () => {
  it('normalizes email and preserves leading zeroes in codes', async () => {
    expect(
      await validateDto({ email: ' AUTHOR@EXAMPLE.COM ' }, ForgotPasswordDto),
    ).toEqual({ email: 'author@example.com' });
    expect(
      (
        await validateDto(
          {
            email: 'author@example.com',
            code: '001234',
            newPassword: 'NewPassword123!',
          },
          ResetPasswordDto,
        )
      ).code,
    ).toBe('001234');
  });

  it.each([123456, '12345', '1234567', 'abcdef', null, undefined])(
    'rejects malformed code %s',
    async (code) => {
      await expect(
        validateDto(
          { email: 'author@example.com', code, newPassword: 'NewPassword123!' },
          ResetPasswordDto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects invalid email, extra fields, and short or overlong passwords', async () => {
    for (const input of [
      { email: 'invalid' },
      { email: 'author@example.com', recipient: 'other@example.com' },
    ]) {
      await expect(
        validateDto(input, ForgotPasswordDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    for (const newPassword of ['short', 'a'.repeat(73), '😀'.repeat(19)]) {
      await expect(
        validateDto(
          { email: 'author@example.com', code: '123456', newPassword },
          ResetPasswordDto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
