import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto.js';

export class AdminUserResponseDto extends UserResponseDto {
  @ApiProperty({ description: 'Total blogs, including drafts', minimum: 0 })
  blogCount: number;
}

export class UserPageResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  items: UserResponseDto[];

  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}
