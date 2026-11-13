import 'reflect-metadata';
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { validateDto } from '../common/validation.utils.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { contactMailSettings, recaptchaSettings } from './contact.config.js';
import { ContactModule } from './contact.module.js';

const input = {
  name: 'Example User',
  email: 'user@example.com',
  subject: 'Technical Issue',
  message: 'I cannot publish my blog post.',
  captchaToken: 'fresh-google-token',
};
const googleOk = {
  success: true,
  hostname: 'bloghub.example.com',
  challenge_ts: new Date().toISOString(),
};
function configure() {
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test',
    RECAPTCHA_SECRET_KEY: 'test-private-secret',
    RECAPTCHA_ALLOWED_HOSTNAMES: 'localhost,bloghub.example.com',
    CONTACT_SUPPORT_EMAIL: 'support@example.com',
    CONTACT_FROM_EMAIL: 'verified@example.com',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_USER: 'smtp-user',
    SMTP_PASSWORD: 'smtp-private-password',
  }))
    vi.stubEnv(key, value);
}

describe('Contact validation and configuration', () => {
  beforeEach(configure);
  afterEach(() => vi.unstubAllEnvs());
  it('trims form values and keeps plain-text multiline messages', async () => {
    const dto = await validateDto(
      {
        ...input,
        name: ' Example User ',
        email: ' user@example.com ',
        subject: ' Technical Issue ',
        message: ' First line\nSecond line ',
        captchaToken: ' token ',
      },
      CreateContactDto,
    );
    expect(dto).toMatchObject({
      name: input.name,
      email: input.email,
      subject: input.subject,
      message: 'First line\nSecond line',
      captchaToken: 'token',
    });
  });
  it.each([
    { name: undefined },
    { name: ' ' },
    { name: 'a' },
    { name: 'x'.repeat(101) },
    { name: { toString: 'bad' } },
    { email: 'invalid' },
    { email: 'x'.repeat(243) + '@example.com' },
    { subject: 'ab' },
    { subject: 'x'.repeat(151) },
    { subject: 'Hello\r\nBcc: stranger@example.com' },
    { name: 'Ab\u0000cd' },
    { message: 'short' },
    { message: 'x'.repeat(2001) },
    { message: 'Hello\u0000world' },
    { captchaToken: undefined },
    { captchaToken: '   ' },
    { captchaToken: 12 },
    { captchaToken: 'x'.repeat(8193) },
    { to: 'attacker@example.com' },
    { userId: 'someone' },
  ])('rejects malformed or oversized fields: %j', async (patch) => {
    await expect(
      validateDto({ ...input, ...patch }, CreateContactDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([
    '',
    'https://bloghub.example.com',
    'bloghub.example.com/path',
    '*.example.com',
    'example.com:3000',
    'example.com,',
    'example.com@evil.com',
  ])('fails closed on invalid hostname configuration: %s', (hosts) => {
    vi.stubEnv('RECAPTCHA_ALLOWED_HOSTNAMES', hosts);
    expect(() => recaptchaSettings()).toThrow(ServiceUnavailableException);
  });
  it('normalizes the explicit hostname allowlist', () => {
    vi.stubEnv(
      'RECAPTCHA_ALLOWED_HOSTNAMES',
      ' LOCALHOST, BlogHub.Example.Com ',
    );
    expect(recaptchaSettings().hostnames).toEqual([
      'localhost',
      'bloghub.example.com',
    ]);
  });
  it('rejects missing secrets and the Google public test secret in production', () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');
    expect(() => recaptchaSettings()).toThrow(ServiceUnavailableException);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(
      'RECAPTCHA_SECRET_KEY',
      '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe',
    );
    expect(() => recaptchaSettings()).toThrow(ServiceUnavailableException);
  });
  it.each([
    ['CONTACT_FROM_EMAIL', 'visitor@example.com\r\nBcc:evil@example.com'],
    ['CONTACT_SUPPORT_EMAIL', 'one@example.com,two@example.com'],
    ['CONTACT_SUPPORT_EMAIL', ''],
    ['SMTP_PASSWORD', ''],
    ['SMTP_PORT', '0'],
    ['SMTP_PORT', 'bad'],
    ['SMTP_PORT', '65536'],
  ])('rejects unsafe/incomplete SMTP configuration %s', (name, value) => {
    vi.stubEnv(name, value);
    expect(() => contactMailSettings()).toThrow(ServiceUnavailableException);
  });
});

describe('Public Contact HTTP API (mocked Google and SMTP)', () => {
  let app: INestApplication;
  let fetchMock: ReturnType<typeof vi.fn>;
  let sendMail: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    configure();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(googleOk)));
    vi.stubGlobal('fetch', fetchMock);
    sendMail = vi
      .fn()
      .mockResolvedValue({ accepted: ['support@example.com'], rejected: [] });
    close = vi.fn();
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail,
      close,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    const module = await Test.createTestingModule({
      imports: [ContactModule],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const post = (app: INestApplication, body: object = input) =>
    request(app.getHttpServer()).post('/api/v1/contact').send(body);
  it('allows a guest, verifies CAPTCHA first, and emails only the configured support address', async () => {
    expect((await post(app).expect(200)).body).toEqual({
      message: 'Your message has been sent successfully.',
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(new URLSearchParams(options.body).get('secret')).toBe(
      'test-private-secret',
    );
    expect(new URLSearchParams(options.body).get('response')).toBe(
      input.captchaToken,
    );
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      sendMail.mock.invocationCallOrder[0],
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: 'verified@example.com',
      to: 'support@example.com',
      replyTo: { name: input.name, address: input.email },
      subject: '[BlogHub Contact] Technical Issue',
      text: `Sender: ${input.name}\nEmail: ${input.email}\nSubject: ${input.subject}\n\n${input.message}`,
    });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        secure: true,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it('does not require or interpret Authorization or associate a visitor with an account', async () => {
    await post(app)
      .set('Authorization', 'Bearer example-signed-in-token')
      .expect(200);
    await post(app).set('Authorization', 'Bearer invalid-token').expect(200);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
  it.each([
    { captchaToken: undefined },
    { email: 'invalid' },
    { message: 'x'.repeat(2001) },
    { subject: 'Hello\r\nBcc: evil@example.com' },
    { to: 'evil@example.com' },
  ])('validates before contacting either provider: %j', async (patch) => {
    await post(app, { ...input, ...patch }).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it.each([
    { success: false, 'error-codes': ['invalid-input-response'] },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, hostname: 'evil.example.com' },
    { success: true, hostname: 'bloghub.example.com.evil.com' },
    { success: true },
  ])(
    'never sends email for rejected or wrong-host CAPTCHA: %j',
    async (result) => {
      fetchMock.mockResolvedValue(Response.json(result));
      await post(app).expect(400);
      expect(sendMail).not.toHaveBeenCalled();
    },
  );
  it('lets Google reject a reused token instead of caching or storing tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(googleOk))
      .mockResolvedValueOnce(
        Response.json({
          success: false,
          'error-codes': ['timeout-or-duplicate'],
        }),
      );
    await post(app).expect(200);
    await post(app).expect(400);
    expect(sendMail).toHaveBeenCalledOnce();
  });
  it.each(['timeout', 'http', 'json', 'malformed', 'secret'])(
    'returns sanitized 503 on Google %s failure',
    async (kind) => {
      if (kind === 'timeout')
        fetchMock.mockRejectedValue(
          new DOMException('private token leak', 'TimeoutError'),
        );
      if (kind === 'http')
        fetchMock.mockResolvedValue(
          new Response('private details', { status: 503 }),
        );
      if (kind === 'json')
        fetchMock.mockResolvedValue(new Response('invalid json'));
      if (kind === 'malformed')
        fetchMock.mockResolvedValue(Response.json({ success: 'true' }));
      if (kind === 'secret')
        fetchMock.mockResolvedValue(
          Response.json({
            success: false,
            'error-codes': ['invalid-input-secret'],
          }),
        );
      const result = await post(app).expect(503);
      expect(JSON.stringify(result.body)).not.toMatch(
        /private|test-private-secret|smtp-private-password/,
      );
      expect(sendMail).not.toHaveBeenCalled();
      expect(
        vi.mocked(Logger.prototype.warn).mock.calls.flat().join(' '),
      ).not.toMatch(/private|fresh-google-token/);
    },
  );
  it.each(['reject', 'empty', 'rejected-recipient', 'transport'])(
    'does not claim delivery on SMTP %s failure',
    async (kind) => {
      if (kind === 'reject')
        sendMail.mockRejectedValue(
          new Error('smtp-private-password: provider failure'),
        );
      if (kind === 'empty')
        sendMail.mockResolvedValue({ accepted: [], rejected: [] });
      if (kind === 'rejected-recipient')
        sendMail.mockResolvedValue({
          accepted: [],
          rejected: ['support@example.com'],
        });
      if (kind === 'transport')
        vi.mocked(nodemailer.createTransport).mockImplementation(() => {
          throw new Error('private SMTP config');
        });
      const result = await post(app).expect(503);
      expect(result.body.message).toContain('could not be sent');
      expect(JSON.stringify(result.body)).not.toMatch(
        /smtp-private-password|provider failure|saved/,
      );
      expect(
        vi.mocked(Logger.prototype.error).mock.calls.flat().join(' '),
      ).toBe('Contact email delivery failed');
    },
  );
  it('fails closed when configuration is missing, without affecting module startup', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');
    await post(app).expect(503);
    expect(sendMail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv('CONTACT_SUPPORT_EMAIL', '');
    await post(app).expect(503);
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('returns 429 after three attempts and cannot be bypassed by forged forwarding headers', async () => {
    for (let i = 0; i < 3; i++)
      await post(app)
        .set('X-Forwarded-For', `192.0.2.${i + 1}`)
        .expect(200);
    await post(app)
      .set('X-Forwarded-For', '198.51.100.99')
      .set('X-Real-IP', '203.0.113.1')
      .expect(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });
  it('documents the route, request, responses and public access in Swagger', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const route = doc.paths['/api/v1/contact'].post!;
    expect(route.security).toBeUndefined();
    expect(route.requestBody).toBeDefined();
    for (const code of ['200', '400', '429', '503'])
      expect(route.responses[code]).toBeDefined();
  });
});
