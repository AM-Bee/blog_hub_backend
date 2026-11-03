import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { FaqService } from './faq.service.js';
import { AskFaqDto, FaqSuggestionsQueryDto } from './dto/faq-input.dto.js';
import {
  FaqAnswerDto,
  FaqCategoryResponseDto,
  FaqSuggestionDto,
  PublicFaqDto,
} from './dto/faq-response.dto.js';
import { dtoValidationPipe } from '../common/validation.utils.js';

@ApiTags('faq')
@ApiTooManyRequestsResponse({
  description: 'Too many FAQ requests; wait before retrying',
})
@UseGuards(ThrottlerGuard)
@Controller('faq')
export class FaqController {
  constructor(@Inject(FaqService) private readonly faqs: FaqService) {}

  @Post('ask')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Find a predefined answer; unknown or ambiguous questions return suggestions',
  })
  @ApiOkResponse({ type: FaqAnswerDto })
  ask(@Body(dtoValidationPipe(AskFaqDto)) input: AskFaqDto) {
    return this.faqs.ask(input);
  }

  @Get('suggestions')
  @ApiOperation({
    summary:
      'Suggested active FAQ questions, optionally filtered by category UUID',
  })
  @ApiOkResponse({ type: [FaqSuggestionDto] })
  suggestions(
    @Query(dtoValidationPipe(FaqSuggestionsQueryDto))
    query: FaqSuggestionsQueryDto,
  ) {
    return this.faqs.suggestions(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categories containing at least one active FAQ' })
  @ApiOkResponse({ type: [FaqCategoryResponseDto] })
  categories() {
    return this.faqs.categories();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one active FAQ by UUID' })
  @ApiOkResponse({ type: PublicFaqDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.faqs.findOne(id);
  }
}
