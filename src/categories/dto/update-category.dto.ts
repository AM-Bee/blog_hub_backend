import { CreateCategoryDto } from './create-category.dto.js';

// Name is the only editable field, so an empty PATCH is invalid.
export class UpdateCategoryDto extends CreateCategoryDto {}
