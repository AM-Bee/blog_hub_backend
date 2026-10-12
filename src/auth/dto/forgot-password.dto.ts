import { PickType } from '@nestjs/swagger';
import { LoginDto } from './login.dto.js';

export class ForgotPasswordDto extends PickType(LoginDto, ['email'] as const) {}
