import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer from 'nodemailer';
import { validateDto } from '../common/validation.utils.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { contactMailSettings } from './contact.config.js';
import { RecaptchaService } from './recaptcha.service.js';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  constructor(
    @Inject(RecaptchaService) private readonly captcha: RecaptchaService,
  ) {}

  async submit(input: CreateContactDto) {
    const dto = await validateDto(input, CreateContactDto);
    const settings = contactMailSettings();
    await this.captcha.verify(dto.captchaToken);
    let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
    try {
      transport = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.port === 465,
        requireTLS: true,
        auth: { user: settings.user, pass: settings.password },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const result = await transport.sendMail({
        from: settings.from,
        to: settings.to,
        replyTo: { name: dto.name, address: dto.email },
        subject: `[BlogHub Contact] ${dto.subject}`,
        text: `Sender: ${dto.name}\nEmail: ${dto.email}\nSubject: ${dto.subject}\n\n${dto.message}`,
      });
      if (!result.accepted?.length || result.rejected?.length)
        throw new Error('Support email not accepted');
    } catch {
      this.logger.error('Contact email delivery failed');
      throw new ServiceUnavailableException(
        'Your message could not be sent. Please try again with a new CAPTCHA.',
      );
    } finally {
      transport?.close();
    }
    return { message: 'Your message has been sent successfully.' };
  }
}
