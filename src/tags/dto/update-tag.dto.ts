import { OmitType } from '@nestjs/mapped-types';
import { CreateTagDto } from './create-tag.dto.js';

// Rename only. The parent category and ownership cannot be changed.
export class UpdateTagDto extends OmitType(CreateTagDto, [
  'categoryId',
] as const) {}
