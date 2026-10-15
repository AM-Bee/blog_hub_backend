import type {
  AdminUser,
  UserPage,
} from '../interfaces/admin-user.interface.js';
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto.js';

export class AdminUserResponseDto extends UserResponseDto implements AdminUser {
  @ApiProperty({ description: 'Total blogs, including drafts', minimum: 0 })
  blogCount: number;
}

export class UserPageResponseDto implements UserPage {
  @ApiProperty({ type: [UserResponseDto] })
  items: UserResponseDto[];

  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}
