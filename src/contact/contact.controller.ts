import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { ContactService } from './contact.service.js';
import {
  ContactResponseDto,
  CreateContactDto,
} from './dto/create-contact.dto.js';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(
    @Inject(ContactService) private readonly contact: ContactService,
  ) {}

  @Post()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { limit: 3, ttl: 15 * 60_000, blockDuration: 15 * 60_000 },
  })
  @ApiOperation({
    summary: 'Public contact form (guests and signed-in visitors)',
    description:
      'No JWT required. Verify a fresh reCAPTCHA v2 Checkbox token and email support. Nothing is stored in the database.',
  })
  @ApiBody({ type: CreateContactDto })
  @ApiOkResponse({ type: ContactResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid fields or invalid, expired, reused, or wrong-hostname CAPTCHA',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Maximum 3 attempts per IP per 15 minutes; wait before retrying',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Missing configuration, CAPTCHA provider unavailable, or email could not be sent; nothing has been saved',
  })
  submit(@Body(dtoValidationPipe(CreateContactDto)) input: CreateContactDto) {
    return this.contact.submit(input);
  }
}
