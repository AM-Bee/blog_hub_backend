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
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CategoryResponseDto } from './dto/category-response.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    @Inject(CategoriesService)
    private readonly categoriesService: CategoriesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all categories' })
  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Read a category by slug' })
  @ApiOkResponse({ type: CategoryResponseDto })
  findOne(@Param('slug') slug: string) {
    return this.categoriesService.findOne(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a category as an author or admin' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @UsePipes(dtoValidationPipe(CreateCategoryDto))
  create(@Body() dto: CreateCategoryDto, @Req() request: AuthenticatedRequest) {
    return this.categoriesService.create(dto, request.user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Edit your own category, or any category as an admin',
  })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiOkResponse({ type: CategoryResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateCategoryDto))
    dto: UpdateCategoryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.categoriesService.update(id, dto, request.user);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a category as an admin' })
  @ApiNoContentResponse()
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.categoriesService.remove(id, request.user);
  }
}
