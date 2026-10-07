import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_OPTIONS } from '../auth.config.js';
import type { AuthOptions } from '../auth.config.js';

@Injectable()
export class CookieOriginGuard implements CanActivate {
  constructor(@Inject(AUTH_OPTIONS) private readonly options: AuthOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (!origin || !this.options.frontendOrigins.includes(origin)) {
      throw new ForbiddenException('An allowed frontend Origin is required');
    }
    return true;
  }
}
