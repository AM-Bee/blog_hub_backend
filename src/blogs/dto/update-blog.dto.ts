import { PartialType } from '@nestjs/swagger';
import { CreateBlogDto } from './create-blog.dto.js';
import { Transform } from 'class-transformer';
import { IsInt, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBlogDto extends PartialType(CreateBlogDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ minimum: 1 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class DeleteBlogQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  version?: number;
}
