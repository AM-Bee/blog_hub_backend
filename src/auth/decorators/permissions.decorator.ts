import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../users/permissions.js';
export const PERMISSIONS_KEY = 'bloghub_permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
