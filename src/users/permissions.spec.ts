import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { UserRole } from './enums/user-role.enum.js';
import {
  effectivePermissions,
  hasPermission,
  Permission,
} from './permissions.js';
import { validateDto } from '../common/validation.utils.js';
import { UpdateUserPermissionsDto } from '../admin-users/dto/update-user-permissions.dto.js';
import { UpdateUserRoleDto } from '../admin-users/dto/update-user-role.dto.js';

@Roles(UserRole.ADMIN)
@RequirePermissions(Permission.FAQS_MANAGE)
class ProtectedController {
  manage() {}
  @RequirePermissions(Permission.FAQS_DELETE)
  remove() {}
  @Roles(UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.USERS_GRANT_ACCESS)
  grant() {}
}
const guard = new RolesGuard(new Reflector());
function context(
  method: 'manage' | 'remove' | 'grant',
  user?: object,
): ExecutionContext {
  return {
    getHandler: () => ProtectedController.prototype[method],
    getClass: () => ProtectedController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
describe('Administrative permissions', () => {
  it('denies implicit admin privileges and ignores unknown or reserved stored permissions', () => {
    expect(effectivePermissions({ role: UserRole.ADMIN })).toEqual([]);
    expect(
      effectivePermissions({
        role: UserRole.ADMIN,
        permissions: [
          'unknown',
          Permission.USERS_GRANT_ACCESS,
          Permission.BLOGS_MODERATE,
        ],
      }),
    ).toEqual([Permission.BLOGS_MODERATE]);
    expect(
      effectivePermissions({
        role: UserRole.AUTHOR,
        permissions: Object.values(Permission),
      }),
    ).toEqual([]);
    for (const permission of Object.values(Permission))
      expect(hasPermission({ role: UserRole.SUPER_ADMIN }, permission)).toBe(
        true,
      );
  });
  it('requires authentication and explicit grants; method requirements replace the class requirement', () => {
    expect(() => guard.canActivate(context('manage'))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(context('manage', { role: UserRole.ADMIN })),
    ).toThrow(ForbiddenException);
    const admin = {
      role: UserRole.ADMIN,
      permissions: [Permission.FAQS_MANAGE],
    };
    expect(guard.canActivate(context('manage', admin))).toBe(true);
    expect(() => guard.canActivate(context('remove', admin))).toThrow(
      ForbiddenException,
    );
    expect(
      guard.canActivate(
        context('remove', { ...admin, permissions: [Permission.FAQS_DELETE] }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        context('grant', {
          role: UserRole.ADMIN,
          permissions: Object.values(Permission),
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(context('grant', { role: UserRole.SUPER_ADMIN })),
    ).toBe(true);
  });
  it.each([
    null,
    'blogs.delete',
    ['unknown'],
    [Permission.USERS_GRANT_ACCESS],
    [Permission.BLOGS_DELETE, Permission.BLOGS_DELETE],
  ])('rejects invalid permission payload %j', async (permissions) => {
    await expect(
      validateDto({ permissions }, UpdateUserPermissionsDto),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validateDto({ role: 'admin', permissions }, UpdateUserRoleDto),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('supports explicit revocation and promotion with optional grants', async () => {
    await expect(
      validateDto({ permissions: [] }, UpdateUserPermissionsDto),
    ).resolves.toMatchObject({ permissions: [] });
    await expect(
      validateDto({}, UpdateUserPermissionsDto),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validateDto({ role: 'super_admin' }, UpdateUserRoleDto),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validateDto(
        { role: 'admin', permissions: [Permission.BLOGS_MODERATE] },
        UpdateUserRoleDto,
      ),
    ).resolves.toMatchObject({ permissions: [Permission.BLOGS_MODERATE] });
  });
});
