import { dtoValidationPipe } from '../common/validation.utils.js';
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
  Req,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import { ListTagsQueryDto } from './dto/list-tags-query.dto.js';
import { TagsService } from './tags.service.js';
import { CreateTagDto } from './dto/create-tag.dto.js';
import { UpdateTagDto } from './dto/update-tag.dto.js';
import { TagResponseDto } from './dto/tag-response.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/enums/user-role.enum.js';

@ApiTags('tags')
@Controller('tags')
export class TagsController {
  constructor(@Inject(TagsService) private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all tags' })
  @ApiOkResponse({ type: TagResponseDto, isArray: true })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    type: String,
    format: 'uuid',
  })
  findAll(
    @Query(dtoValidationPipe(ListTagsQueryDto))
    query: ListTagsQueryDto,
  ) {
    return this.tagsService.findAll(query.categoryId);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Read a tag by slug' })
  @ApiOkResponse({ type: TagResponseDto })
  findOne(@Param('slug') slug: string) {
    return this.tagsService.findOne(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a tag as an author or admin' })
  @ApiBody({ type: CreateTagDto })
  @ApiCreatedResponse({ type: TagResponseDto })
  @UsePipes(dtoValidationPipe(CreateTagDto))
  create(@Body() dto: CreateTagDto, @Req() request: AuthenticatedRequest) {
    return this.tagsService.create(dto, request.user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit your own tag, or any tag as an admin' })
  @ApiBody({ type: UpdateTagDto })
  @ApiOkResponse({ type: TagResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateTagDto))
    dto: UpdateTagDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tagsService.update(id, dto, request.user);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a tag as an admin' })
  @ApiNoContentResponse()
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tagsService.remove(id, request.user);
  }
}
