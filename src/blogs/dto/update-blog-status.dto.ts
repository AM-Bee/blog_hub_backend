import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BlogStatus } from '../entities/blog.entity.js';

export class UpdateBlogStatusDto {
  @ApiProperty({
    enum: BlogStatus,
    description: 'draft blocks author publishing; published clears the block',
  })
  @IsEnum(BlogStatus)
  status: BlogStatus;
}
