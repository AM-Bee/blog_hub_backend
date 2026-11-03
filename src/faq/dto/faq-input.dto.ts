import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimArray = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item: unknown) =>
        typeof item === 'string' ? item.trim() : item,
      )
    : value;

export class AskFaqDto {
  @ApiProperty({
    example: 'How do I create a blog post?',
    minLength: 1,
    maxLength: 500,
  })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  @Matches(/[\p{L}\p{N}]/u, {
    message: 'question must contain a letter or number',
  })
  question: string;
}

export class CreateFaqDto extends AskFaqDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId: string;
  @ApiProperty({
    example: 'Create a post through POST /api/v1/blogs after signing in.',
    maxLength: 10000,
  })
  @Transform(trim)
  @IsString()
  @Length(1, 10000)
  answer: string;
  @ApiPropertyOptional({ type: [String], default: [], maxItems: 20 })
  @Transform(trimArray)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  alternativeQuestions: string[] = [];
  @ApiPropertyOptional({ type: [String], default: [], maxItems: 20 })
  @Transform(trimArray)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  keywords: string[] = [];
  @ApiPropertyOptional({ default: true }) @IsBoolean() isActive: boolean = true;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1000000 })
  @IsInt()
  @Min(0)
  @Max(1000000)
  displayOrder: number = 0;
}

export class UpdateFaqDto extends PartialType(CreateFaqDto, {
  skipNullProperties: false,
}) {
  // PATCH must not apply the create DTO's defaults to omitted fields.
  constructor() {
    super();
    delete this.alternativeQuestions;
    delete this.keywords;
    delete this.isActive;
    delete this.displayOrder;
  }
}

export class FaqCategoryInputDto {
  @ApiProperty({ example: 'Blog Management', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(/[\p{L}\p{N}]/u)
  name: string;
  @ApiProperty({ example: 'blog-management', maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;
}

export class UpdateFaqCategoryDto extends PartialType(FaqCategoryInputDto, {
  skipNullProperties: false,
}) {}

export class FaqSuggestionsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_o, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit: number = 5;
}

export class ListFaqsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_o, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page: number = 1;
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @ValidateIf((_o, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
