import { ServiceUnavailableException } from '@nestjs/common';
import { isEmail } from 'class-validator';

export function recaptchaSettings() {
  const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
  const hostnames = (process.env.RECAPTCHA_ALLOWED_HOSTNAMES ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase());
  const validHostname = (hostname: string) => {
    try {
      return (
        !!hostname &&
        hostname.length <= 253 &&
        !/[:/*@\s?#\\]/.test(hostname) &&
        new URL(`https://${hostname}`).hostname === hostname
      );
    } catch {
      return false;
    }
  };
  // Google's public test secret always passes; never accept it in production.
  const testSecret = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
  if (
    !secret ||
    !hostnames.every(validHostname) ||
    (process.env.NODE_ENV === 'production' && secret === testSecret)
  )
    throw new ServiceUnavailableException(
      'Contact verification is not configured',
    );
  return { secret, hostnames };
}

export function contactMailSettings() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = process.env;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const from = process.env.CONTACT_FROM_EMAIL?.trim();
  const to = process.env.CONTACT_SUPPORT_EMAIL?.trim();
  const address = (value: string | undefined) =>
    !!value && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) && isEmail(value);
  if (
    !SMTP_HOST ||
    !SMTP_USER ||
    !SMTP_PASSWORD ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !address(from) ||
    !address(to)
  )
    throw new ServiceUnavailableException('Contact email is not configured');
  return {
    host: SMTP_HOST,
    port,
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from: from!,
    to: to!,
  };
}
