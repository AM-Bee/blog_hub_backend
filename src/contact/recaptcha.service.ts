import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { recaptchaSettings } from './contact.config.js';

@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);

  async verify(token: string): Promise<void> {
    const { secret, hostnames } = recaptchaSettings();
    let result: unknown;
    try {
      const response = await fetch(
        'https://www.google.com/recaptcha/api/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret, response: token }).toString(),
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('Verification unavailable');
      result = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        typeof Reflect.get(result, 'success') !== 'boolean'
      )
        throw new Error('Invalid verification response');
    } catch {
      this.logger.warn('Contact CAPTCHA provider unavailable');
      throw new ServiceUnavailableException(
        'Contact verification is temporarily unavailable. Please try again.',
      );
    }
    const errors: unknown = Reflect.get(result as object, 'error-codes');
    if (
      Array.isArray(errors) &&
      errors.some((code) =>
        [
          'missing-input-secret',
          'invalid-input-secret',
          'bad-request',
        ].includes(code),
      )
    ) {
      this.logger.warn('Contact CAPTCHA provider configuration rejected');
      throw new ServiceUnavailableException(
        'Contact verification is temporarily unavailable. Please try again.',
      );
    }
    const hostname: unknown = Reflect.get(result as object, 'hostname');
    if (
      Reflect.get(result as object, 'success') !== true ||
      typeof hostname !== 'string' ||
      !hostnames.includes(hostname.toLowerCase())
    )
      throw new BadRequestException(
        'CAPTCHA verification failed. Please complete a new challenge.',
      );
  }
}
