import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, ValidateBy } from 'class-validator';

export class NewPasswordDto {
  @ApiProperty({
    minLength: 8,
    writeOnly: true,
    description: 'At most 72 UTF-8 bytes',
  })
  @IsString()
  @MinLength(8)
  @ValidateBy({
    name: 'maxNewPasswordBytes',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
      defaultMessage: () => 'newPassword must not exceed 72 UTF-8 bytes',
    },
  })
  newPassword: string;
}
