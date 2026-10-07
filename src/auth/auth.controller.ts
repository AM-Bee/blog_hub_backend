import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import {
  AUTH_OPTIONS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from './auth.config.js';
import type { AuthOptions } from './auth.config.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AccessTokenResponseDto } from './dto/access-token-response.dto.js';
import { UserResponseDto } from '../users/dto/user-response.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from './guards/jwt-auth.guard.js';
import { CookieOriginGuard } from './guards/cookie-origin.guard.js';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register an author account' })
  @ApiBody({ type: CreateUserDto })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      expectedType: CreateUserDto,
    }),
  )
  register(@Body() dto: CreateUserDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CookieOriginGuard)
  @ApiOperation({ summary: 'Sign in and set a refresh cookie' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: AccessTokenResponseDto })
  @ApiHeader({
    name: 'Origin',
    required: true,
    example: 'http://localhost:3000',
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      expectedType: LoginDto,
    }),
  )
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);
    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...this.cookieOptions(),
      expires: result.expiresAt,
    });
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: AccessTokenResponseDto })
  @ApiHeader({
    name: 'Origin',
    required: true,
    example: 'http://localhost:3000',
  })
  @UseGuards(CookieOriginGuard)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and renew the access token',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.authService.refresh(
        this.refreshCookie(request),
      );
      response.cookie(REFRESH_COOKIE, result.refreshToken, {
        ...this.cookieOptions(),
        expires: result.expiresAt,
      });
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    } catch (error) {
      if (error instanceof UnauthorizedException)
        response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(CookieOriginGuard)
  @ApiOperation({ summary: 'Revoke the current session and clear its cookie' })
  @ApiHeader({
    name: 'Origin',
    required: true,
    example: 'http://localhost:3000',
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(this.refreshCookie(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the signed-in user profile' })
  @ApiOkResponse({ type: UserResponseDto })
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }

  private refreshCookie(request: Request): unknown {
    return (request.cookies as Record<string, unknown> | undefined)?.[
      REFRESH_COOKIE
    ];
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.options.secureCookies,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
    };
  }
}
