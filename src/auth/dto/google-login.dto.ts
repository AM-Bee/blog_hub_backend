import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, ValidateIf } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    writeOnly: true,
    description:
      'Google ID token received server-side by Auth.js, not an access token',
  })
  @IsString()
  @Length(1, 10000)
  idToken: string;

  @ApiProperty({ required: false, writeOnly: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 72)
  password?: string;
}
