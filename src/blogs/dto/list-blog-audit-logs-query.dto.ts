import { IsInt, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BlogPaginationQueryDto } from './list-blogs-query.dto.js';

export class ListBlogAuditLogsQueryDto extends BlogPaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
}
