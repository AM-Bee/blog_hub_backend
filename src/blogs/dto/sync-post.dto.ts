import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncPostDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID()
  operationId: string;
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID()
  entityId: string;
  @ApiProperty({ enum: ['CREATE', 'UPDATE', 'DELETE'] })
  @IsIn(['CREATE', 'UPDATE', 'DELETE'])
  type: 'CREATE' | 'UPDATE' | 'DELETE';

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) =>
    value === 'null' ? null : typeof value === 'string' ? Number(value) : value,
  )
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  baseVersion?: number | null;

  @ApiPropertyOptional({
    description:
      'CreateBlogDto or UpdateBlogDto; JSON encoded for multipart requests',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })
  @ValidateIf((object: SyncPostDto) => object.type !== 'DELETE')
  @IsObject()
  input?: Record<string, unknown>;
}

export class SyncPostsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  after?: string;
}
