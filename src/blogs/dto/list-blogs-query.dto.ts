import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BlogStatus } from '../enums/blog-status.enum.js';

export class BlogPaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

const trimFilter = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListBlogsQueryDto extends BlogPaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Case-insensitive partial title/content search',
  })
  @Transform(trimFilter)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 200)
  q?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Exact category slug' })
  @Transform(trimFilter)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 500)
  category?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Exact tag slug' })
  @Transform(trimFilter)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 500)
  tag?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Case-insensitive partial author display-name match',
  })
  @Transform(trimFilter)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 100)
  author?: string;
}

export class ManageBlogsQueryDto extends BlogPaginationQueryDto {
  @ApiPropertyOptional({ enum: BlogStatus })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(BlogStatus)
  status?: BlogStatus;
}
