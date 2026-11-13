import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  NotContains,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
// Header fields must stay on one line, even before Nodemailer encodes them.
const singleLine = /^[^\p{Cc}\p{Zl}\p{Zp}]*$/u;

export class CreateContactDto {
  @ApiProperty({ minLength: 2, maxLength: 100, example: 'Example User' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  @Matches(singleLine)
  name: string;

  @ApiProperty({ format: 'email', maxLength: 254, example: 'user@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  @Matches(singleLine)
  email: string;

  @ApiProperty({ minLength: 3, maxLength: 150, example: 'Technical Issue' })
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  @Matches(singleLine)
  subject: string;

  @ApiProperty({
    minLength: 10,
    maxLength: 2000,
    example: 'I cannot publish my blog post.',
  })
  @Transform(trim)
  @IsString()
  @Length(10, 2000)
  @NotContains('\u0000')
  message: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 8192,
    description:
      'Fresh, single-use Google reCAPTCHA v2 Checkbox response token',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 8192)
  captchaToken: string;
}

export class ContactResponseDto {
  @ApiProperty({ example: 'Your message has been sent successfully.' })
  message: string;
}
