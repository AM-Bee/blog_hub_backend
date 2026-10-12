import { PartialType, PickType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, ValidateIf } from 'class-validator';
import { CreateUserDto } from './create-user.dto.js';

export class UpdateUserDto extends PartialType(
  PickType(CreateUserDto, ['displayName', 'email'] as const),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    writeOnly: true,
    description: 'Required when changing email',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 72)
  currentPassword?: string;
}
