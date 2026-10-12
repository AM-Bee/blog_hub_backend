import { ApiProperty } from '@nestjs/swagger';
import { ACCESS_TOKEN_SECONDS } from '../auth.config.js';

export class AccessTokenResponseDto {
  @ApiProperty({ description: 'JWT for the Authorization Bearer header' })
  accessToken: string;

  @ApiProperty({
    example: ACCESS_TOKEN_SECONDS,
    description: 'Access token lifetime in seconds',
  })
  expiresIn: number;
}
