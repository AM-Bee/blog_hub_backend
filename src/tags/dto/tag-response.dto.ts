import type { Tag } from '../interfaces/tag.interface.js';
import { ApiProperty } from '@nestjs/swagger';

export class TagResponseDto implements Tag {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  categoryId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ format: 'uuid' })
  createdById: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}
