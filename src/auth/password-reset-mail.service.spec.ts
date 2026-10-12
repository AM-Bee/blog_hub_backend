import { ServiceUnavailableException } from '@nestjs/common';
import { PasswordResetMailService } from './password-reset-mail.service.js';

const smtp = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: smtp.createTransport },
}));

describe('Forgot-password email delivery', () => {
  beforeEach(() => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_USER', 'sender@example.com');
    vi.stubEnv('SMTP_PASSWORD', 'test-secret');
    vi.stubEnv('SMTP_FROM', 'sender@example.com');
    smtp.createTransport
      .mockReset()
      .mockReturnValue({ sendMail: smtp.sendMail });
    smtp.sendMail
      .mockReset()
      .mockResolvedValue({ accepted: ['recipient@example.com'] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sends the code to the requested registered email over TLS', async () => {
    await new PasswordResetMailService().sendCode(
      'recipient@example.com',
      '001234',
    );
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        requireTLS: true,
      }),
    );
    expect(smtp.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        text: expect.stringContaining('001234'),
      }),
    );
  });

  it('uses STARTTLS for port 587 and rejects SMTP rejection', async () => {
    vi.stubEnv('SMTP_PORT', '587');
    smtp.sendMail.mockResolvedValueOnce({ accepted: [] });
    await expect(
      new PasswordResetMailService().sendCode(
        'recipient@example.com',
        '123456',
      ),
    ).rejects.toThrow('Reset email was not accepted');
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
    );
  });

  it('reports missing or invalid configuration without connecting', () => {
    vi.stubEnv('SMTP_PASSWORD', '');
    expect(() => new PasswordResetMailService().ensureConfigured()).toThrow(
      ServiceUnavailableException,
    );
    vi.stubEnv('SMTP_PASSWORD', 'test-secret');
    vi.stubEnv('SMTP_PORT', 'invalid');
    expect(() => new PasswordResetMailService().ensureConfigured()).toThrow(
      ServiceUnavailableException,
    );
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });
});
