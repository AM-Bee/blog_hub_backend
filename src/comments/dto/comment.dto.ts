import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import type {
  BlogComment,
  CommentPage,
} from '../interfaces/comment.interface.js';
import { BlogAuthorDto } from '../../blogs/dto/blog-response.dto.js';

export class CommentContentDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 2000,
    description: 'Plain text; surrounding whitespace is trimmed',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 2000)
  content: string;
}

export class CommentResponseDto implements BlogComment {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) blogId: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) parentId:
    string | null;
  @ApiProperty({ type: BlogAuthorDto }) author: BlogAuthorDto;
  @ApiProperty({ description: 'Plain text, never render as HTML' })
  content: string;
  @ApiProperty({
    minimum: 0,
    description: 'Direct replies; always zero for a reply',
  })
  replyCount: number;
  @ApiProperty({ minimum: 0 }) likeCount: number;
  @ApiProperty({ minimum: 0 }) dislikeCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class CommentPageResponseDto implements CommentPage {
  @ApiProperty({ type: [CommentResponseDto] }) items: CommentResponseDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}
