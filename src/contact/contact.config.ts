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
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  const from = process.env.GMAIL_SENDER_EMAIL?.trim();
  const to = process.env.CONTACT_SUPPORT_EMAIL?.trim();
  const address = (value: string | undefined) =>
    !!value && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) && isEmail(value);
  if (
    !clientId ||
    !clientSecret ||
    !refreshToken ||
    !address(from) ||
    !address(to)
  )
    throw new ServiceUnavailableException(
      'Contact Gmail API is not configured',
    );
  return {
    clientId,
    clientSecret,
    refreshToken,
    from: from!,
    to: to!,
  };
}
