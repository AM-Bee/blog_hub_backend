import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { AdminUsersService } from './admin-users.service.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';
import {
  AdminUserResponseDto,
  UserPageResponseDto,
} from './dto/admin-user-response.dto.js';

@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    @Inject(AdminUsersService) private readonly users: AdminUsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List and search users as an admin' })
  @ApiOkResponse({ type: UserPageResponseDto })
  findAll(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        expectedType: ListUsersQueryDto,
      }),
    )
    query: ListUsersQueryDto,
  ) {
    return this.users.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View a user and total blog count as an admin' })
  @ApiOkResponse({ type: AdminUserResponseDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Enable or disable an author account as an admin' })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiOkResponse({ type: AdminUserResponseDto })
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        expectedType: UpdateUserStatusDto,
      }),
    )
    dto: UpdateUserStatusDto,
  ) {
    return this.users.updateStatus(id, dto);
  }
}
