import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListTagsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter tags by category',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
