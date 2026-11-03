import { ApiProperty } from '@nestjs/swagger';
import { BlogResponseDto } from './blog-response.dto.js';

export class PostSyncPageDto {
  @ApiProperty({ type: [BlogResponseDto], maxItems: 20 })
  items: BlogResponseDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor:
    string | null;
}

export class PostSyncBlogDto {
  @ApiProperty({ type: BlogResponseDto }) blog: BlogResponseDto;
}

export class PostSyncDeletedDto {
  @ApiProperty({ example: true }) deleted: true;
  @ApiProperty({ format: 'uuid' }) id: string;
}
