import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { normalizeTaxonomyName } from '../../common/taxonomy.utils.js';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Web Development', minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeTaxonomyName(value) : value,
  )
  @IsString()
  @Length(1, 100)
  @Matches(/[\p{L}\p{N}]/u, { message: 'name must contain a letter or number' })
  name: string;
}
