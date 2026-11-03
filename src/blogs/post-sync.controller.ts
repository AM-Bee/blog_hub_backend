import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiOkResponse,
  ApiTags,
  ApiExtraModels,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { BlogsRepository } from './blogs.repository.js';
import { blogImageUploadOptions } from './blog-image.store.js';
import { SyncPostDto, SyncPostsQueryDto } from './dto/sync-post.dto.js';
import {
  PostSyncPageDto,
  PostSyncBlogDto,
  PostSyncDeletedDto,
} from './dto/post-sync-response.dto.js';
import { PostSyncService } from './post-sync.service.js';

@Controller('me/blog-sync')
@ApiTags('post synchronization')
@ApiExtraModels(SyncPostDto, PostSyncBlogDto, PostSyncDeletedDto)
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
export class PostSyncController {
  constructor(
    @Inject(PostSyncService) private readonly sync: PostSyncService,
    @Inject(BlogsRepository) private readonly posts: BlogsRepository,
  ) {}

  @Get()
  @ApiOkResponse({ type: PostSyncPageDto })
  @ApiQuery({ type: SyncPostsQueryDto })
  @ApiOperation({
    summary:
      'Full own-post snapshot, keyset paginated; reconcile missing posts only after all pages',
  })
  snapshot(
    @Query(dtoValidationPipe(SyncPostsQueryDto)) query: SyncPostsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.posts.syncPage(request.user, query.after);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(PostSyncBlogDto) },
        { $ref: getSchemaPath(PostSyncDeletedDto) },
      ],
    },
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(SyncPostDto) },
        {
          type: 'object',
          properties: { image: { type: 'string', format: 'binary' } },
        },
      ],
    },
  })
  @ApiOperation({
    summary:
      'Apply an idempotent own-post operation with an expected version; optional image multipart field',
  })
  @UseInterceptors(
    FileInterceptor('image', {
      ...blogImageUploadOptions,
      limits: { ...blogImageUploadOptions.limits, fieldSize: 1_000_000 },
    }),
  )
  apply(
    @Body(dtoValidationPipe(SyncPostDto)) input: SyncPostDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sync.apply(input, request.user, image);
  }
}
