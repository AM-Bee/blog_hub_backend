import { ApiProperty } from '@nestjs/swagger';
import type {
  AdminFaq,
  FaqAnswer,
  FaqCategory,
  FaqPage,
  FaqSuggestion,
  PublicFaq,
} from '../interfaces/faq.interface.js';

export class FaqCategoryResponseDto implements FaqCategory {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Blog Management' }) name: string;
  @ApiProperty({ example: 'blog-management' }) slug: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}
export class FaqSuggestionDto implements FaqSuggestion {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'How do I create a blog post?' }) question: string;
  @ApiProperty({ example: 'Blog Management' }) category: string;
}
export class PublicFaqDto extends FaqSuggestionDto implements PublicFaq {
  @ApiProperty({
    example: 'Sign in, then create a post through POST /api/v1/blogs.',
  })
  answer: string;
}
export class AdminFaqDto extends PublicFaqDto implements AdminFaq {
  @ApiProperty({ format: 'uuid' }) categoryId: string;
  @ApiProperty({ type: [String] }) alternativeQuestions: string[];
  @ApiProperty({ type: [String] }) keywords: string[];
  @ApiProperty() isActive: boolean;
  @ApiProperty() displayOrder: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
export class FaqPageDto implements FaqPage {
  @ApiProperty({ type: [AdminFaqDto] }) items: AdminFaqDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}
export class FaqAnswerDto implements FaqAnswer {
  @ApiProperty({ example: true }) found: boolean;
  @ApiProperty({
    example: 'Sign in, then create a post through POST /api/v1/blogs.',
  })
  answer: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'How do I create a blog post?',
  })
  matchedQuestion: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Blog Management' })
  category: string | null;
  @ApiProperty({ type: [FaqSuggestionDto] }) suggestions: FaqSuggestionDto[];
}
