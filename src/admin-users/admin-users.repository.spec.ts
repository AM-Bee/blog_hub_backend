import type { Repository } from 'typeorm';
import { AdminUsersRepository } from './admin-users.repository.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import type { User } from '../users/interfaces/user.interface.js';
import { Permission } from '../users/permissions.js';

const main = { id: 'main', role: UserRole.SUPER_ADMIN } as User;
const delegated = {
  id: 'admin',
  role: UserRole.ADMIN,
  permissions: [Permission.USERS_MANAGE],
} as User;
function fixture(role = UserRole.AUTHOR, status = UserStatus.ACTIVE) {
  const user = { id: 'target', role, status, permissions: [] };
  const manager = { findOne: vi.fn().mockResolvedValue(user), update: vi.fn() };
  const transaction = vi.fn(async (work: (manager: object) => unknown) =>
    work(manager),
  );
  const repository = new AdminUsersRepository({
    manager: { transaction },
  } as unknown as Repository<UserEntity>);
  vi.spyOn(repository, 'findOne').mockResolvedValue(user as never);
  return { repository, manager, transaction };
}
describe('Admin access assignment', () => {
  it('does not allow a regular admin to promote or grant access', async () => {
    const f = fixture();
    await expect(
      f.repository.updateRole('target', { role: UserRole.ADMIN }, delegated),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.repository.updatePermissions(
        'target',
        { permissions: [Permission.BLOGS_DELETE] },
        delegated,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('promotes with an empty explicit grant list by default', async () => {
    const f = fixture();
    await f.repository.updateRole('target', { role: UserRole.ADMIN }, main);
    expect(f.manager.update).toHaveBeenCalledWith(
      UserEntity,
      { id: 'target' },
      { role: UserRole.ADMIN, permissions: [] },
    );
  });
  it('preserves grants on repeated promotion and replaces them when supplied', async () => {
    const f = fixture(UserRole.ADMIN);
    await f.repository.updateRole('target', { role: UserRole.ADMIN }, main);
    expect(f.manager.update).not.toHaveBeenCalled();
    await f.repository.updateRole(
      'target',
      { role: UserRole.ADMIN, permissions: [Permission.BLOGS_MODERATE] },
      main,
    );
    expect(f.manager.update).toHaveBeenCalledWith(
      UserEntity,
      { id: 'target' },
      { role: UserRole.ADMIN, permissions: [Permission.BLOGS_MODERATE] },
    );
    await f.repository.updatePermissions('target', { permissions: [] }, main);
    expect(f.manager.update).toHaveBeenLastCalledWith(
      UserEntity,
      { id: 'target' },
      { permissions: [] },
    );
  });
  it('rejects promoting a disabled author and assigning grants to an author', async () => {
    const f = fixture(UserRole.AUTHOR, UserStatus.DISABLED);
    await expect(
      f.repository.updateRole('target', { role: UserRole.ADMIN }, main),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.repository.updatePermissions('target', { permissions: [] }, main),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.manager.update).not.toHaveBeenCalled();
  });
  it('protects the main admin from role, grants, and status changes even by itself', async () => {
    const f = fixture(UserRole.SUPER_ADMIN);
    await expect(
      f.repository.updateRole('target', { role: UserRole.ADMIN }, main),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.repository.updatePermissions('target', { permissions: [] }, main),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.repository.updateStatus(
        'target',
        { status: UserStatus.DISABLED },
        main,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.manager.update).not.toHaveBeenCalled();
  });
  it('prevents regular admins from disabling peers but allows main admin to do so', async () => {
    const f = fixture(UserRole.ADMIN);
    await expect(
      f.repository.updateStatus(
        'target',
        { status: UserStatus.DISABLED },
        delegated,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.manager.update).not.toHaveBeenCalled();
    await f.repository.updateStatus(
      'target',
      { status: UserStatus.DISABLED },
      main,
    );
    expect(f.manager.update).toHaveBeenCalledWith(
      UserEntity,
      { id: 'target' },
      { status: UserStatus.DISABLED },
    );
    expect(f.manager.update).toHaveBeenCalledTimes(3);
  });
});
