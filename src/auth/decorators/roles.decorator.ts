import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../users/enums/user-role.enum.js';

export const ROLES_KEY = 'bloghub_roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
