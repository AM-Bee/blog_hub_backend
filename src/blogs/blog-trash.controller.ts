import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { Permission } from '../users/permissions.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { BlogPaginationQueryDto } from './dto/list-blogs-query.dto.js';
import {
  BlogTrashPageResponseDto,
  BlogTrashResponseDto,
} from './dto/blog-trash-response.dto.js';
import { BlogResponseDto } from './dto/blog-response.dto.js';
import { BlogsService } from './blogs.service.js';

@ApiTags('blog-trash')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
@Controller()
export class BlogTrashController {
  constructor(@Inject(BlogsService) private readonly blogs: BlogsService) {}

  @Get('me/blog-trash')
  @ApiOperation({ summary: 'List your trashed posts, newest deletion first' })
  @ApiOkResponse({ type: BlogTrashPageResponseDto })
  findMine(
    @Query(dtoValidationPipe(BlogPaginationQueryDto))
    query: BlogPaginationQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.findTrash(query, request.user);
  }

  @Get('me/blog-trash/:id')
  @ApiOperation({ summary: 'Read your trashed post' })
  @ApiOkResponse({ type: BlogTrashResponseDto })
  findMyOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.findTrashedOne(id, request.user);
  }

  @Post('me/blog-trash/:id/restore')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Restore your post as a draft; admin-trashed posts require admin restoration',
  })
  @ApiOkResponse({ type: BlogResponseDto })
  restoreMine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.restore(id, request.user);
  }

  @Delete('me/blog-trash/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Permanently delete your trashed post and its comments/reactions',
  })
  @ApiNoContentResponse()
  purgeMine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.purge(id, request.user);
  }

  @Get('admin/blog-trash')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.BLOGS_MODERATE)
  @ApiOperation({ summary: 'Inspect all trashed posts with blogs.moderate' })
  @ApiOkResponse({ type: BlogTrashPageResponseDto })
  findAll(
    @Query(dtoValidationPipe(BlogPaginationQueryDto))
    query: BlogPaginationQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.findTrash(query, request.user, true);
  }

  @Get('admin/blog-trash/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.BLOGS_MODERATE)
  @ApiOperation({ summary: 'Inspect a trashed post with blogs.moderate' })
  @ApiOkResponse({ type: BlogTrashResponseDto })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.findTrashedOne(id, request.user, true);
  }

  @Post('admin/blog-trash/:id/restore')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.BLOGS_RESTORE)
  @ApiOperation({
    summary: 'Restore any trashed post as a draft with blogs.restore',
  })
  @ApiOkResponse({ type: BlogResponseDto })
  restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.restore(id, request.user, true);
  }

  @Delete('admin/blog-trash/:id')
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.BLOGS_PURGE)
  @ApiOperation({
    summary: 'Permanently delete a trashed post with blogs.purge',
  })
  @ApiNoContentResponse()
  purge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogs.purge(id, request.user, true);
  }
}
