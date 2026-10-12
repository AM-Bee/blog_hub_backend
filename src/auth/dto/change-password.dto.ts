import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { NewPasswordDto } from './new-password.dto.js';

export class ChangePasswordDto extends NewPasswordDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 72)
  currentPassword: string;
}
