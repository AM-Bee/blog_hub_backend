import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { Permission } from '../users/permissions.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { AdminUsersService } from './admin-users.service.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';
import { UpdateUserRoleDto } from './dto/update-user-role.dto.js';
import {
  AdminUserResponseDto,
  UserPageResponseDto,
} from './dto/admin-user-response.dto.js';

@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@RequirePermissions(Permission.USERS_MANAGE)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    @Inject(AdminUsersService) private readonly users: AdminUsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List and search users as an admin' })
  @ApiOkResponse({ type: UserPageResponseDto })
  findAll(
    @Query(dtoValidationPipe(ListUsersQueryDto))
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

  @Roles(UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.USERS_GRANT_ACCESS)
  @Patch(':id')
  @ApiOperation({ summary: 'Promote an active author to admin' })
  @ApiBody({ type: UpdateUserRoleDto })
  @ApiOkResponse({ type: AdminUserResponseDto })
  updateRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateUserRoleDto)) dto: UpdateUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.updateRole(id, dto, request.user);
  }

  @Patch(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.USERS_GRANT_ACCESS)
  @ApiOperation({
    summary: 'Replace a regular admin permissions list (main admin only)',
  })
  @ApiBody({ type: UpdateUserPermissionsDto })
  @ApiOkResponse({ type: AdminUserResponseDto })
  updatePermissions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateUserPermissionsDto))
    dto: UpdateUserPermissionsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.updatePermissions(id, dto, request.user);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary:
      'Enable/disable authors with users.manage; main admin may also change regular admins',
  })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiOkResponse({ type: AdminUserResponseDto })
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateUserStatusDto))
    dto: UpdateUserStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.updateStatus(id, dto, request.user);
  }
}
