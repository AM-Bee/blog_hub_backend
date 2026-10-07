import { PartialType } from '@nestjs/swagger';
import { CreateBlogDto } from './create-blog.dto.js';

export class UpdateBlogDto extends PartialType(CreateBlogDto, {
  skipNullProperties: false,
}) {}
