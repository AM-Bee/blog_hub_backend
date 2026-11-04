import {
  Equals,
  IsArray,
  ArrayUnique,
  ArrayMaxSize,
  IsIn,
  ValidateIf,
} from 'class-validator';
import { ADMIN_PERMISSIONS, Permission } from '../../users/permissions.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../users/enums/user-role.enum.js';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: [UserRole.ADMIN], example: UserRole.ADMIN })
  @Equals(UserRole.ADMIN, { message: 'role must be admin' })
  role: UserRole.ADMIN;

  @ApiPropertyOptional({ enum: ADMIN_PERMISSIONS, isArray: true, default: [] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ADMIN_PERMISSIONS.length)
  @IsIn(ADMIN_PERMISSIONS, { each: true })
  permissions?: Permission[];
}
