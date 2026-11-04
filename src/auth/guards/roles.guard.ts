import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '../../users/permissions.js';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';
import { UserRole } from '../../users/enums/user-role.enum.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

// Use after JwtAuthGuard so the role comes from the current database user.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length && !permissions?.length) {
      return true;
    }
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      throw new UnauthorizedException();
    }
    const allowedRole =
      !roles?.length ||
      roles.includes(user.role) ||
      (user.role === UserRole.SUPER_ADMIN && roles.includes(UserRole.ADMIN));
    if (
      !allowedRole ||
      permissions?.some((permission) => !hasPermission(user, permission))
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
