import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { NewPasswordDto } from './new-password.dto.js';

export class ResetPasswordDto extends NewPasswordDto {
  @ApiProperty({ example: 'author@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'Six-digit code from email',
    writeOnly: true,
  })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
