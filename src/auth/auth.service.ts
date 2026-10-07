import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import type { CreateUserDto } from '../users/dto/create-user.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import { RefreshSessionEntity } from './entities/refresh-session.entity.js';
import { RefreshTokenEntity } from './entities/refresh-token.entity.js';
import { ACCESS_TOKEN_SECONDS, SESSION_MILLISECONDS } from './auth.config.js';

export type AuthUser = Awaited<ReturnType<UsersService['findOne']>>;

@Injectable()
export class AuthService {
  constructor(
    @Inject(UsersService) private readonly usersService: UsersService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RefreshSessionEntity)
    private readonly sessionRepository: Repository<RefreshSessionEntity>,
  ) {}

  register(dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findOneByEmail(dto.email);
    if (
      !user ||
      Buffer.byteLength(dto.password, 'utf8') > 72 ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const session = Object.assign(new RefreshSessionEntity(), {
      id: randomUUID(),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_MILLISECONDS),
      revokedAt: null,
    });
    const refreshToken = this.newRefreshToken(session.id);
    // Sign before saving: a signing failure must not leave a usable session.
    const accessToken = await this.signAccessToken(session);
    await this.dataSource.transaction(async (manager) => {
      await manager.save(RefreshSessionEntity, session);
      await manager.save(
        RefreshTokenEntity,
        this.tokenRecord(session.id, refreshToken),
      );
    });
    return {
      accessToken,
      refreshToken,
      expiresAt: session.expiresAt,
      expiresIn: ACCESS_TOKEN_SECONDS,
    };
  }

  async refresh(refreshToken: unknown) {
    const sessionId = this.sessionId(refreshToken);
    if (!sessionId || typeof refreshToken !== 'string')
      throw new UnauthorizedException('Invalid refresh token');
    const result = await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(RefreshSessionEntity, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      )
        return null;
      const token = await manager.findOneBy(RefreshTokenEntity, {
        tokenHash: this.hash(refreshToken),
        sessionId,
      });
      if (!token) return null;
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
    if (!result)
      throw new UnauthorizedException('Invalid or expired refresh session');
    return result;
  }

  async logout(refreshToken: unknown): Promise<void> {
    const sessionId = this.sessionId(refreshToken);
    if (!sessionId || typeof refreshToken !== 'string') return;
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(RefreshSessionEntity, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session || session.revokedAt) return;
      const token = await manager.findOneBy(RefreshTokenEntity, {
        tokenHash: this.hash(refreshToken),
        sessionId,
      });
      if (!token) return;
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
    const session = await this.sessionRepository.findOneBy({
      id: payload.sid,
      userId: payload.sub,
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Session is no longer active');
    }
    try {
      return await this.usersService.findOne(payload.sub);
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new UnauthorizedException('Account no longer exists');
      throw error;
    }
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
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    return parts.length === 2 &&
      this.isUuid(parts[0]) &&
      /^[A-Za-z0-9_-]{43}$/.test(parts[1])
      ? parts[0]
      : null;
  }
}
