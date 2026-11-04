import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayUnique, ArrayMaxSize, IsIn } from 'class-validator';
import { ADMIN_PERMISSIONS, Permission } from '../../users/permissions.js';
export class UpdateUserPermissionsDto {
  @ApiProperty({ enum: ADMIN_PERMISSIONS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ADMIN_PERMISSIONS.length)
  @IsIn(ADMIN_PERMISSIONS, { each: true })
  permissions: Permission[];
}
