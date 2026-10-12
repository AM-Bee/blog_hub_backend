import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class PasswordResetMailService {
  private settings() {
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
    const port = Number(process.env.SMTP_PORT ?? 587);
    if (
      !SMTP_HOST ||
      !SMTP_USER ||
      !SMTP_PASSWORD ||
      !SMTP_FROM ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new ServiceUnavailableException(
        'Password reset email is not configured',
      );
    }
    return {
      host: SMTP_HOST,
      port,
      user: SMTP_USER,
      password: SMTP_PASSWORD,
      from: SMTP_FROM,
    };
  }

  ensureConfigured() {
    this.settings();
  }

  async sendCode(email: string, code: string) {
    const settings = this.settings();
    const transport = nodemailer.createTransport({
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
      to: email,
      subject: 'BlogHub password reset code',
      text: `Your BlogHub password reset code is: ${code}\n\nThis code expires in 15 minutes and can only be used once. If you did not request a password reset, ignore this email.`,
    });
    if (!result.accepted.length)
      throw new Error('Reset email was not accepted');
  }
}
