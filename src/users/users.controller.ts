import { Controller } from '@nestjs/common';

// User account operations remain internal to UsersService in v1.
// Public registration is handled by AuthController.
@Controller('users')
export class UsersController {}
