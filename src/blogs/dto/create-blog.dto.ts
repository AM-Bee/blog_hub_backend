import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BlogStatus } from '../enums/blog-status.enum.js';

export class CreateBlogDto {
  @ApiProperty({ maxLength: 200, example: 'Getting started with Ballet' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'title must not be blank' })
  title: string;

  @ApiProperty({ maxLength: 100000, description: 'Markdown content' })
  @IsString()
  @Length(1, 100000)
  @Matches(/\S/, { message: 'content must not be blank' })
  content: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 10,
    description: 'Unique tag UUIDs belonging to categoryId',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 2048,
    description:
      'HTTP(S) image URL; null clears it. Uploaded images use a public Supabase Storage URL.',
  })
  @Transform(({ value }: { value: unknown }) =>
    value === 'null' ? null : value,
  )
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2048)
  coverImageUrl?: string | null;

  @ApiPropertyOptional({ enum: BlogStatus, default: BlogStatus.DRAFT })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(BlogStatus)
  status?: BlogStatus;
}
