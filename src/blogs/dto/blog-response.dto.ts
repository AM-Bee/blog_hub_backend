import type {
  Blog,
  BlogAuthor,
  BlogBase,
  BlogCategory,
  BlogPage,
  BlogSummary,
  BlogTag,
} from '../interfaces/blog.interface.js';
import { ApiProperty } from '@nestjs/swagger';
import { BlogStatus } from '../enums/blog-status.enum.js';

export class BlogAuthorDto implements BlogAuthor {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() displayName: string;
}
export class BlogCategoryDto implements BlogCategory {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}
export class BlogTagDto extends BlogCategoryDto implements BlogTag {
  @ApiProperty({ format: 'uuid' }) categoryId: string;
}
export class BlogBaseResponseDto implements BlogBase {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: BlogAuthorDto }) author: BlogAuthorDto;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) categoryId:
    string | null;
  @ApiProperty({ type: BlogCategoryDto, nullable: true })
  category: BlogCategoryDto | null;
  @ApiProperty({ description: 'Category name or Uncategorized' })
  categoryName: string;
  @ApiProperty({ type: [BlogTagDto] }) tags: BlogTagDto[];
  @ApiProperty({ type: String, nullable: true }) coverImageUrl: string | null;
  @ApiProperty({ enum: BlogStatus }) status: BlogStatus;
  @ApiProperty({
    description:
      'An admin has blocked publishing; only the admin status route can clear this flag',
  })
  publicationBlocked: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
export class BlogResponseDto extends BlogBaseResponseDto implements Blog {
  @ApiProperty({ description: 'Full Markdown content' }) content: string;
}
export class BlogSummaryDto extends BlogBaseResponseDto implements BlogSummary {
  @ApiProperty({
    description: 'First 200 Unicode characters of Markdown content',
  })
  excerpt: string;
}
export class BlogPageResponseDto implements BlogPage {
  @ApiProperty({ type: [BlogSummaryDto] }) items: BlogSummaryDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}
