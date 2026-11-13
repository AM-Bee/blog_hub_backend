import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { validateDto } from '../common/validation.utils.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { GmailMailService } from './gmail-mail.service.js';
import { RecaptchaService } from './recaptcha.service.js';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  constructor(
    @Inject(RecaptchaService) private readonly captcha: RecaptchaService,
    @Inject(GmailMailService) private readonly mail: GmailMailService,
  ) {}

  async submit(input: CreateContactDto) {
    const dto = await validateDto(input, CreateContactDto);
    await this.captcha.verify(dto.captchaToken);
    try {
      await this.mail.send(dto);
    } catch {
      this.logger.error('Contact email delivery failed');
      throw new ServiceUnavailableException(
        'Your message could not be sent. Please try again with a new CAPTCHA.',
      );
    }
    return { message: 'Your message has been sent successfully.' };
  }
}
