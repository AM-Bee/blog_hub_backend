import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { GoogleLoginDto } from './google-login.dto.js';

export class LinkGoogleDto extends PickType(GoogleLoginDto, [
  'idToken',
] as const) {
  @ApiProperty({
    writeOnly: true,
    description: 'Current BlogHub account password',
  })
  @IsString()
  @Length(1, 72)
  currentPassword: string;
}
