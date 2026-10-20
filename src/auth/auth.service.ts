import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsNull, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { AuthRepository } from './auth.repository.js';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import type { CreateUserDto } from '../users/dto/create-user.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import { RefreshSessionEntity } from './entities/refresh-session.entity.js';
import { RefreshTokenEntity } from './entities/refresh-token.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { validateDto } from '../common/validation.utils.js';
import { ACCESS_TOKEN_SECONDS, SESSION_MILLISECONDS } from './auth.config.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { PasswordResetMailService } from './password-reset-mail.service.js';
import type { AuthUser, AuthTokens } from './interfaces/auth.interface.js';

import { GoogleTokenService } from './google-token.service.js';
import { GoogleLoginDto } from './dto/google-login.dto.js';
import { LinkGoogleDto } from './dto/link-google.dto.js';
import { AuthAccountEntity } from './entities/auth-account.entity.js';

const RESET_LIFETIME = 15 * 60 * 1000;
const RESET_MESSAGE =
  'If this email is registered, a password reset code has been sent.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @Inject(UsersService) private readonly usersService: UsersService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(PasswordResetMailService)
    private readonly resetMail: PasswordResetMailService,
    @Inject(GoogleTokenService)
    private readonly googleTokens: GoogleTokenService,
  ) {}

  register(dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    // Serialize login with password changes so an old password cannot create a new session.
    return this.repository.transaction(async (manager) => {
      const user = await this.repository.findLockedUserByEmail(
        manager,
        dto.email.trim().toLowerCase(),
      );
      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !user.passwordHash ||
        Buffer.byteLength(dto.password, 'utf8') > 72 ||
        !(await bcrypt.compare(dto.password, user.passwordHash))
      ) {
        throw new UnauthorizedException('Invalid email or password');
      }
      return this.createSession(manager, user.id);
    });
  }

  async googleLogin(input: GoogleLoginDto): Promise<AuthTokens> {
    const dto = await validateDto(input, GoogleLoginDto);
    const identity = await this.googleTokens.verify(dto.idToken);
    try {
      return await this.repository.transaction(async (manager) => {
        const account = await this.repository.findGoogleAccount(
          manager,
          identity.subject,
        );
        let user: UserEntity | null;
        if (account) {
          // A provider link is permanent. Never rematch it by a changed email.
          user = await this.repository.findLockedUserById(
            manager,
            account.userId,
          );
        } else {
          user = await this.repository.findLockedUserByEmail(
            manager,
            identity.email,
          );
          if (user) {
            throw new ConflictException({
              code: 'GOOGLE_LINK_REQUIRED',
              message:
                'Sign in with your existing password, then link Google to your account.',
            });
          }
          user = await manager.save(
            UserEntity,
            manager.create(UserEntity, {
              email: identity.email,
              displayName: identity.displayName,
              passwordHash: null,
              role: UserRole.AUTHOR,
              status: UserStatus.ACTIVE,
            }),
          );
          await manager.save(
            AuthAccountEntity,
            manager.create(AuthAccountEntity, {
              userId: user.id,
              provider: 'google',
              providerAccountId: identity.subject,
            }),
          );
        }
        if (!user || user.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('Account is unavailable');
        }
        return this.createSession(manager, user.id);
      });
    } catch (error) {
      this.rethrowGoogleConflict(error);
    }
  }

  async linkGoogle(userId: string, input: LinkGoogleDto) {
    const dto = await validateDto(input, LinkGoogleDto);
    const identity = await this.googleTokens.verify(dto.idToken);
    try {
      await this.repository.transaction(async (manager) => {
        const user = await this.repository.findLockedUserById(manager, userId);
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          !user.passwordHash ||
          Buffer.byteLength(dto.currentPassword, 'utf8') > 72 ||
          !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
        ) {
          throw new UnauthorizedException('Current password is incorrect');
        }
        const account = await this.repository.findGoogleAccount(
          manager,
          identity.subject,
        );
        if (account) {
          if (account.userId !== user.id) {
            throw new ConflictException(
              'This Google account is already linked to another user',
            );
          }
          return; // Repeating the same confirmed link is safe.
        }
        if (identity.email !== user.email) {
          throw new BadRequestException(
            'Google email must match your current account email',
          );
        }
        await manager.save(
          AuthAccountEntity,
          manager.create(AuthAccountEntity, {
            userId: user.id,
            provider: 'google',
            providerAccountId: identity.subject,
          }),
        );
      });
    } catch (error) {
      this.rethrowGoogleConflict(error);
    }
    return { message: 'Google account linked successfully' };
  }

  private rethrowGoogleConflict(error: unknown): never {
    if (error instanceof QueryFailedError) {
      const failure = error.driverError as {
        code?: string;
        constraint?: string;
      };
      if (
        failure.code === '23505' &&
        [
          'UQ_users_email',
          'UQ_auth_accounts_provider_identity',
          'UQ_auth_accounts_user_provider',
        ].includes(failure.constraint ?? '')
      ) {
        throw new ConflictException(
          'Account or Google link already exists. Sign in again; existing accounts must link Google after password login.',
        );
      }
    }
    throw error;
  }

  async changePassword(userId: string, input: ChangePasswordDto) {
    const dto = await validateDto(input, ChangePasswordDto);
    await this.repository.transaction(async (manager) => {
      const user = await this.repository.findLockedUserById(manager, userId);
      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !user.passwordHash ||
        Buffer.byteLength(dto.currentPassword, 'utf8') > 72 ||
        !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
      ) {
        throw new UnauthorizedException('Current password is incorrect');
      }
      await this.replacePassword(manager, user.id, dto.newPassword);
    });
    return { message: 'Password changed successfully. Please log in again.' };
  }

  async forgotPassword(input: ForgotPasswordDto) {
    const dto = await validateDto(input, ForgotPasswordDto);
    this.resetMail.ensureConfigured();
    await this.repository.transaction(async (manager) => {
      const user = await this.repository.findLockedResetUser(
        manager,
        dto.email,
      );
      if (!user || user.status !== UserStatus.ACTIVE) {
        return;
      }
      // Limit mail to one request per minute per account, even across IP addresses.
      if (
        user.passwordResetExpiresAt &&
        user.passwordResetExpiresAt.getTime() - RESET_LIFETIME + 60_000 >
          Date.now()
      ) {
        return;
      }
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const codeHash = await bcrypt.hash(code, 10);
      try {
        await this.resetMail.sendCode(user.email, code);
      } catch {
        // Do not expose account existence or log codes/SMTP credentials.
        this.logger.error('Password reset email delivery failed');
        return;
      }
      await manager.update(
        UserEntity,
        { id: user.id },
        {
          passwordResetCodeHash: codeHash,
          passwordResetExpiresAt: new Date(Date.now() + RESET_LIFETIME),
          passwordResetAttempts: 0,
        },
      );
    });
    return { message: RESET_MESSAGE };
  }

  async resetPassword(input: ResetPasswordDto) {
    const dto = await validateDto(input, ResetPasswordDto);
    const reset = await this.repository.transaction(async (manager) => {
      const user = await this.repository.findLockedResetUser(
        manager,
        dto.email,
      );
      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !user.passwordResetCodeHash ||
        !user.passwordResetExpiresAt ||
        user.passwordResetExpiresAt.getTime() <= Date.now() ||
        user.passwordResetAttempts >= 5
      ) {
        return false;
      }
      if (!(await bcrypt.compare(dto.code, user.passwordResetCodeHash))) {
        await manager.update(
          UserEntity,
          { id: user.id },
          { passwordResetAttempts: user.passwordResetAttempts + 1 },
        );
        // Return so failed attempts are committed rather than rolled back.
        return false;
      }
      await this.replacePassword(manager, user.id, dto.newPassword);
      return true;
    });
    if (!reset) {
      throw new BadRequestException('Invalid or expired reset code');
    }
    return { message: 'Password reset successfully. Please log in again.' };
  }

  private async replacePassword(
    manager: EntityManager,
    userId: string,
    password: string,
  ) {
    const passwordHash = await bcrypt.hash(password, 10);
    await manager.update(
      UserEntity,
      { id: userId },
      {
        passwordHash,
        passwordResetCodeHash: null,
        passwordResetExpiresAt: null,
        passwordResetAttempts: 0,
      },
    );
    await manager.update(
      RefreshSessionEntity,
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async refresh(refreshToken: unknown): Promise<AuthTokens> {
    const sessionId = this.sessionId(refreshToken);
    if (!sessionId || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const result = await this.repository.transaction(async (manager) => {
      const session = await this.repository.findLockedSession(
        manager,
        sessionId,
      );
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        return null;
      }
      const user = await this.repository.findUser(manager, session.userId);
      if (!user || user.status !== UserStatus.ACTIVE) {
        return null;
      }
      const token = await this.repository.findToken(
        manager,
        sessionId,
        this.hash(refreshToken),
      );
      if (!token) {
        return null;
      }
      if (token.usedAt) {
        session.revokedAt = new Date();
        await manager.save(RefreshSessionEntity, session);
        // Return instead of throwing so the revocation transaction commits.
        return null;
      }
      const nextToken = this.newRefreshToken(session.id);
      const accessToken = await this.signAccessToken(session);
      // Include the primary key explicitly because tokenHash is select:false.
      await manager.update(
        RefreshTokenEntity,
        { tokenHash: this.hash(refreshToken) },
        { usedAt: new Date() },
      );
      await manager.save(
        RefreshTokenEntity,
        this.tokenRecord(session.id, nextToken),
      );
      return {
        accessToken,
        refreshToken: nextToken,
        expiresAt: session.expiresAt,
        expiresIn: ACCESS_TOKEN_SECONDS,
      };
    });
    if (!result) {
      throw new UnauthorizedException('Invalid or expired refresh session');
    }
    return result;
  }

  async logout(refreshToken: unknown): Promise<void> {
    const sessionId = this.sessionId(refreshToken);
    if (!sessionId || typeof refreshToken !== 'string') {
      return;
    }
    await this.repository.transaction(async (manager) => {
      const session = await this.repository.findLockedSession(
        manager,
        sessionId,
      );
      if (!session || session.revokedAt) {
        return;
      }
      const token = await this.repository.findToken(
        manager,
        sessionId,
        this.hash(refreshToken),
      );
      if (!token) {
        return;
      }
      session.revokedAt = new Date();
      await manager.save(RefreshSessionEntity, session);
    });
  }

  async authenticate(accessToken: string): Promise<AuthUser> {
    let payload: { sub?: unknown; sid?: unknown };
    try {
      payload = await this.jwtService.verifyAsync(accessToken, {
        algorithms: ['HS256'],
        issuer: 'bloghub',
        audience: 'bloghub-api',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      !this.isUuid(payload.sub) ||
      !this.isUuid(payload.sid)
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    const session = await this.repository.findSession(payload.sid, payload.sub);
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Session is no longer active');
    }
    try {
      const user = await this.usersService.findOne(payload.sub);
      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Account is disabled');
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('Account no longer exists');
      }
      throw error;
    }
  }
  // Both login methods create exactly the same application session.
  private async createSession(
    manager: EntityManager,
    userId: string,
  ): Promise<AuthTokens> {
    const session = Object.assign(new RefreshSessionEntity(), {
      id: randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + SESSION_MILLISECONDS),
      revokedAt: null,
    });
    const refreshToken = this.newRefreshToken(session.id);
    const accessToken = await this.signAccessToken(session);
    await manager.save(RefreshSessionEntity, session);
    await manager.save(
      RefreshTokenEntity,
      this.tokenRecord(session.id, refreshToken),
    );
    return {
      accessToken,
      refreshToken,
      expiresAt: session.expiresAt,
      expiresIn: ACCESS_TOKEN_SECONDS,
    };
  }

  private signAccessToken(session: RefreshSessionEntity) {
    return this.jwtService.signAsync(
      { sub: session.userId, sid: session.id },
      {
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_SECONDS,
        issuer: 'bloghub',
        audience: 'bloghub-api',
      },
    );
  }

  private newRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(32).toString('base64url')}`;
  }

  private tokenRecord(
    sessionId: string,
    refreshToken: string,
  ): RefreshTokenEntity {
    return Object.assign(new RefreshTokenEntity(), {
      sessionId,
      tokenHash: this.hash(refreshToken),
      usedAt: null,
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private sessionId(token: unknown): string | null {
    if (typeof token !== 'string') {
      return null;
    }
    const parts = token.split('.');
    return parts.length === 2 &&
      this.isUuid(parts[0]) &&
      /^[A-Za-z0-9_-]{43}$/.test(parts[1])
      ? parts[0]
      : null;
  }
}
