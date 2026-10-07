import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../users/entities/user.entity.js';

export const ROLES_KEY = 'bloghub_roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
