import { UserRole } from './enums/user-role.enum.js';

export enum Permission {
  BLOGS_MODERATE = 'blogs.moderate',
  BLOGS_DELETE = 'blogs.delete',
  TAXONOMY_MANAGE = 'taxonomy.manage',
  TAXONOMY_DELETE = 'taxonomy.delete',
  COMMENTS_DELETE = 'comments.delete',
  FAQS_MANAGE = 'faqs.manage',
  FAQS_DELETE = 'faqs.delete',
  USERS_MANAGE = 'users.manage',
  USERS_GRANT_ACCESS = 'users.grant_access',
}
export const ADMIN_PERMISSIONS = Object.values(Permission).filter(
  (permission) => permission !== Permission.USERS_GRANT_ACCESS,
);
export function effectivePermissions(user: {
  role: UserRole;
  permissions?: readonly string[];
}): Permission[] {
  if (user.role === UserRole.SUPER_ADMIN) return Object.values(Permission);
  if (user.role !== UserRole.ADMIN) return [];
  return ADMIN_PERMISSIONS.filter((permission) =>
    user.permissions?.includes(permission),
  );
}
export function hasPermission(
  user: { role: UserRole; permissions?: readonly string[] },
  permission: Permission,
): boolean {
  return effectivePermissions(user).includes(permission);
}
