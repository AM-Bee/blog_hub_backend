import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiConsumes,
  ApiExtraModels,
  getSchemaPath,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { blogImageUploadOptions } from './blog-image.store.js';
import { BlogsService } from './blogs.service.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { UpdateBlogDto } from './dto/update-blog.dto.js';
import { UpdateBlogStatusDto } from './dto/update-blog-status.dto.js';
import {
  ListBlogsQueryDto,
  ManageBlogsQueryDto,
} from './dto/list-blogs-query.dto.js';
import {
  BlogPageResponseDto,
  BlogResponseDto,
} from './dto/blog-response.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';

import { dtoValidationPipe } from '../common/validation.utils.js';

@ApiTags('blogs')
@ApiExtraModels(CreateBlogDto, UpdateBlogDto)
@Controller()
export class BlogsController {
  constructor(
    @Inject(BlogsService) private readonly blogsService: BlogsService,
  ) {}

  @Get('blogs')
  @ApiOperation({ summary: 'Search and filter published blogs' })
  @ApiQuery({ type: ListBlogsQueryDto })
  @ApiOkResponse({ type: BlogPageResponseDto })
  findAll(
    @Query(dtoValidationPipe(ListBlogsQueryDto)) query: ListBlogsQueryDto,
  ) {
    return this.blogsService.findAll(query);
  }

  @Get('blogs/:slug')
  @ApiOperation({ summary: 'Read a published blog by slug' })
  @ApiOkResponse({ type: BlogResponseDto })
  findOne(@Param('slug') slug: string) {
    return this.blogsService.findOne(slug);
  }

  @Get('me/blogs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List your own blogs and drafts' })
  @ApiOkResponse({ type: BlogPageResponseDto })
  findMine(
    @Query(dtoValidationPipe(ManageBlogsQueryDto)) query: ManageBlogsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.findMine(query, request.user);
  }

  @Get('me/blogs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Read your own blog for editing' })
  @ApiOkResponse({ type: BlogResponseDto })
  findMyOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.findMyOne(id, request.user);
  }

  @Get('admin/blogs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all blogs as an admin' })
  @ApiOkResponse({ type: BlogPageResponseDto })
  findAllForAdmin(
    @Query(dtoValidationPipe(ManageBlogsQueryDto)) query: ManageBlogsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.findAllForAdmin(query, request.user);
  }

  @Get('admin/blogs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Read any blog as an admin' })
  @ApiOkResponse({ type: BlogResponseDto })
  findOneForAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.findOneForAdmin(id, request.user);
  }

  @Patch('admin/blogs/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Publish any blog or unpublish it and block author publishing',
  })
  @ApiBody({ type: UpdateBlogStatusDto })
  @ApiOkResponse({ type: BlogResponseDto })
  updateStatusForAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateBlogStatusDto)) dto: UpdateBlogStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.updateStatusForAdmin(id, dto, request.user);
  }

  @Post('blogs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a blog owned by the signed-in user' })
  @UseInterceptors(FileInterceptor('image', blogImageUploadOptions))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(CreateBlogDto) },
        {
          type: 'object',
          properties: {
            image: {
              type: 'string',
              format: 'binary',
              description: 'Optional JPEG/PNG/WebP cover image, maximum 5 MB',
            },
          },
        },
      ],
    },
  })
  @ApiCreatedResponse({ type: BlogResponseDto })
  create(
    @Body(dtoValidationPipe(CreateBlogDto)) dto: CreateBlogDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.create(dto, request.user, image);
  }

  @Patch('blogs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Edit or publish your own blog (authors and admins)',
  })
  @UseInterceptors(FileInterceptor('image', blogImageUploadOptions))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(UpdateBlogDto) },
        {
          type: 'object',
          properties: {
            image: {
              type: 'string',
              format: 'binary',
              description: 'Optional JPEG/PNG/WebP cover image, maximum 5 MB',
            },
          },
        },
      ],
    },
  })
  @ApiOkResponse({ type: BlogResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateBlogDto)) dto: UpdateBlogDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.update(id, dto, request.user, image);
  }

  @Delete('blogs/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete your blog, or any blog as an admin' })
  @ApiNoContentResponse()
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.blogsService.remove(id, request.user);
  }
}
