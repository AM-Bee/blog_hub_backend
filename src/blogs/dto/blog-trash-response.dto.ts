import { ApiProperty } from '@nestjs/swagger';
import { BlogResponseDto, BlogSummaryDto } from './blog-response.dto.js';
import type {
  BlogTrash,
  BlogTrashPage,
  BlogTrashSummary,
} from '../interfaces/blog.interface.js';

export class BlogTrashResponseDto extends BlogResponseDto implements BlogTrash {
  @ApiProperty({ type: String, format: 'date-time' }) deletedAt: Date;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) deletedById:
    string | null;
  @ApiProperty() canRestore: boolean;
  @ApiProperty() canPermanentlyDelete: boolean;
}
export class BlogTrashSummaryDto
  extends BlogSummaryDto
  implements BlogTrashSummary
{
  @ApiProperty({ type: String, format: 'date-time' }) deletedAt: Date;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) deletedById:
    string | null;
  @ApiProperty() canRestore: boolean;
  @ApiProperty() canPermanentlyDelete: boolean;
}
export class BlogTrashPageResponseDto implements BlogTrashPage {
  @ApiProperty({ type: [BlogTrashSummaryDto] }) items: BlogTrashSummaryDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}
