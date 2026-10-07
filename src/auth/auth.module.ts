import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AUTH_OPTIONS, authOptions } from './auth.config.js';
import { RefreshSessionEntity } from './entities/refresh-session.entity.js';
import { RefreshTokenEntity } from './entities/refresh-token.entity.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { CookieOriginGuard } from './guards/cookie-origin.guard.js';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([RefreshSessionEntity, RefreshTokenEntity]),
    JwtModule.registerAsync({
      useFactory: () => ({ secret: authOptions().secret }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_OPTIONS, useFactory: authOptions },
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    CookieOriginGuard,
    ThrottlerGuard,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
