import { ApiProperty } from '@nestjs/swagger';
import { BlogAuditAction } from '../enums/blog-audit-action.enum.js';
import type {
  BlogAuditChanges,
  BlogAuditSnapshot,
  BlogAuditLogSummary,
  BlogAuditLog,
  BlogAuditLogPage,
} from '../interfaces/blog-audit-log.interface.js';

export class BlogAuditLogSummaryDto implements BlogAuditLogSummary {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) blogId: string;
  @ApiProperty() blogTitle: string;
  @ApiProperty({ format: 'uuid' }) actorId: string;
  @ApiProperty({ format: 'uuid' }) postAuthorId: string;
  @ApiProperty({ enum: BlogAuditAction }) action: BlogAuditAction;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class BlogAuditLogResponseDto
  extends BlogAuditLogSummaryDto
  implements BlogAuditLog
{
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Changed fields with old/new values; empty for deletion',
    example: { title: { old: 'Original title', new: 'Updated title' } },
  })
  changes: BlogAuditChanges;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'Post snapshot before deletion; null for other actions',
  })
  snapshot: BlogAuditSnapshot | null;
}

export class BlogAuditLogPageResponseDto implements BlogAuditLogPage {
  @ApiProperty({ type: [BlogAuditLogSummaryDto] })
  items: BlogAuditLogSummaryDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}
