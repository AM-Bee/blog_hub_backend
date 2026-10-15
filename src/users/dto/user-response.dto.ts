import type { User } from '../interfaces/user.interface.js';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum.js';
import { UserStatus } from '../enums/user-status.enum.js';

// Private account profile for auth/me; never includes credentials.
export class UserResponseDto implements User {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}
