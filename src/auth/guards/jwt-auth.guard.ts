import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth.service.js';
import type { AuthUser } from '../interfaces/auth.interface.js';

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  sessionId: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match) {
      throw new UnauthorizedException('Bearer access token is required');
    }
    const authenticated = await this.authService.authenticateSession(match[1]);
    request.user = authenticated.user;
    request.sessionId = authenticated.sessionId;
    return true;
  }
}
