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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { FaqService } from './faq.service.js';
import {
  CreateFaqDto,
  FaqCategoryInputDto,
  ListFaqsQueryDto,
  UpdateFaqCategoryDto,
  UpdateFaqDto,
} from './dto/faq-input.dto.js';
import {
  AdminFaqDto,
  FaqCategoryResponseDto,
  FaqPageDto,
} from './dto/faq-response.dto.js';

@ApiTags('admin-faq')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminFaqController {
  constructor(@Inject(FaqService) private readonly faqs: FaqService) {}

  @Post('faqs')
  @ApiOperation({ summary: 'Create a predefined FAQ answer' })
  @ApiCreatedResponse({ type: AdminFaqDto })
  create(@Body(dtoValidationPipe(CreateFaqDto)) input: CreateFaqDto) {
    return this.faqs.create(input);
  }

  @Get('faqs')
  @ApiOperation({
    summary:
      'Page through active/inactive FAQs; filter by categoryId and isActive',
  })
  @ApiOkResponse({ type: FaqPageDto })
  list(@Query(dtoValidationPipe(ListFaqsQueryDto)) query: ListFaqsQueryDto) {
    return this.faqs.list(query);
  }

  @Get('faqs/:id')
  @ApiOperation({
    summary: 'Read a FAQ including its matching and activation settings',
  })
  @ApiOkResponse({ type: AdminFaqDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.faqs.findOne(id, false);
  }

  @Patch('faqs/:id')
  @ApiOperation({
    summary:
      'Edit or activate/deactivate a FAQ without changing omitted fields',
  })
  @ApiOkResponse({ type: AdminFaqDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateFaqDto)) input: UpdateFaqDto,
  ) {
    return this.faqs.update(id, input);
  }

  @Delete('faqs/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Permanently delete a FAQ; use isActive=false to hide it instead',
  })
  @ApiNoContentResponse()
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.faqs.remove(id);
  }

  @Post('faq-categories')
  @ApiOperation({
    summary: 'Create a FAQ category with a unique name and slug',
  })
  @ApiCreatedResponse({ type: FaqCategoryResponseDto })
  @ApiConflictResponse({ description: 'Name or slug already exists' })
  createCategory(
    @Body(dtoValidationPipe(FaqCategoryInputDto)) input: FaqCategoryInputDto,
  ) {
    return this.faqs.createCategory(input);
  }

  @Get('faq-categories')
  @ApiOperation({
    summary: 'List all FAQ categories, including empty categories',
  })
  @ApiOkResponse({ type: [FaqCategoryResponseDto] })
  categories() {
    return this.faqs.categories(false);
  }

  @Patch('faq-categories/:id')
  @ApiOperation({ summary: 'Rename a FAQ category or change its slug' })
  @ApiOkResponse({ type: FaqCategoryResponseDto })
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(UpdateFaqCategoryDto)) input: UpdateFaqCategoryDto,
  ) {
    return this.faqs.updateCategory(id, input);
  }

  @Delete('faq-categories/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an empty FAQ category' })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'Move or delete FAQs in this category first',
  })
  removeCategory(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.faqs.removeCategory(id);
  }
}
