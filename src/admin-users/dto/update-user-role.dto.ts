import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { UserRole } from '../../users/enums/user-role.enum.js';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: [UserRole.ADMIN], example: UserRole.ADMIN })
  @Equals(UserRole.ADMIN, { message: 'role must be admin' })
  role: UserRole.ADMIN;
}
