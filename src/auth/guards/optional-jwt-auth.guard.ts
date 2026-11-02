import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth.service.js';
import type { AuthUser } from '../interfaces/auth.interface.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

export interface OptionalAuthenticatedRequest extends Request {
  user?: AuthUser;
}

@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  constructor(@Inject(AuthService) authService: AuthService) {
    super(authService);
  }

  override canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<OptionalAuthenticatedRequest>();
    // A supplied token must be valid; only a missing header is anonymous.
    return request.headers.authorization === undefined
      ? Promise.resolve(true)
      : super.canActivate(context);
  }
}
