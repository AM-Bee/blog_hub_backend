import { validateDto } from '../../common/validation.utils.js';
import { UpdateUserRoleDto } from './update-user-role.dto.js';

describe('Admin promotion input', () => {
  it('accepts promotion to admin', async () => {
    await expect(
      validateDto({ role: 'admin' }, UpdateUserRoleDto),
    ).resolves.toMatchObject({ role: 'admin' });
  });

  it.each([
    {},
    { role: null },
    { role: 'author' },
    { role: 'ADMIN' },
    { role: 'owner' },
    { role: 'admin', status: 'active' },
  ])(
    'rejects missing roles, demotion, invalid roles, and extra fields (%j)',
    async (input) => {
      await expect(validateDto(input, UpdateUserRoleDto)).rejects.toMatchObject(
        { status: 400 },
      );
    },
  );
});
