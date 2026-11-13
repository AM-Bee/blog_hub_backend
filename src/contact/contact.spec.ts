import 'reflect-metadata';
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  gmail,
  auth as gmailAuth,
} from 'googleapis/build/src/apis/gmail/index.js';

vi.mock('googleapis/build/src/apis/gmail/index.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('googleapis/build/src/apis/gmail/index.js')
  >()),
  gmail: vi.fn(),
}));
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
    GMAIL_SENDER_EMAIL: 'verified@example.com',
    GMAIL_CLIENT_ID: 'gmail-client-id',
    GMAIL_CLIENT_SECRET: 'gmail-private-secret',
    GMAIL_REFRESH_TOKEN: 'gmail-private-refresh-token',
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
    ['GMAIL_SENDER_EMAIL', 'visitor@example.com\r\nBcc:evil@example.com'],
    ['CONTACT_SUPPORT_EMAIL', 'one@example.com,two@example.com'],
    ['CONTACT_SUPPORT_EMAIL', ''],
    ['GMAIL_SENDER_EMAIL', ''],
    ['GMAIL_CLIENT_ID', ''],
    ['GMAIL_CLIENT_SECRET', ''],
    ['GMAIL_REFRESH_TOKEN', ''],
  ])('rejects unsafe/incomplete Gmail configuration %s', (name, value) => {
    vi.stubEnv(name, value);
    expect(() => contactMailSettings()).toThrow(ServiceUnavailableException);
  });
  it.each([
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
    'GMAIL_SENDER_EMAIL',
    'CONTACT_SUPPORT_EMAIL',
  ])(
    'rejects missing %s at module startup without making a provider request',
    async (name) => {
      vi.stubEnv(name, '');
      await expect(
        Test.createTestingModule({ imports: [ContactModule] }).compile(),
      ).rejects.toThrow('Contact Gmail API is not configured');
    },
  );
});

describe('Public Contact HTTP API (mocked reCAPTCHA and Gmail API)', () => {
  let app: INestApplication;
  let fetchMock: ReturnType<typeof vi.fn>;
  let sendGmail: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    configure();
    vi.mocked(gmail).mockReset();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(googleOk)));
    vi.stubGlobal('fetch', fetchMock);
    sendGmail = vi.fn().mockResolvedValue({ data: { id: 'gmail-message-id' } });
    vi.mocked(gmail).mockReturnValue({
      users: { messages: { send: sendGmail } },
    } as unknown as ReturnType<typeof gmail>);
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
      sendGmail.mock.invocationCallOrder[0],
    );
    const [params, sendOptions] = sendGmail.mock.calls[0];
    expect(params.userId).toBe('me');
    expect(params.requestBody.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const mime = Buffer.from(params.requestBody.raw, 'base64url').toString(
      'utf8',
    );
    const [headers, body] = mime.split('\r\n\r\n');
    expect(headers).toContain('From: verified@example.com');
    expect(headers).toContain('To: support@example.com');
    expect(headers).toContain('Reply-To: Example User <user@example.com>');
    expect(headers).toContain('Subject: [BlogHub Contact] Technical Issue');
    expect(headers).toContain('Content-Type: text/plain; charset=utf-8');
    const text = headers.includes('Content-Transfer-Encoding: base64')
      ? Buffer.from(body, 'base64').toString('utf8')
      : body;
    expect(text).toContain(input.message);
    expect(sendOptions).toMatchObject({ timeout: 10000, retry: false });
    expect(sendOptions.signal).toBeInstanceOf(AbortSignal);
    const auth = vi.mocked(gmail).mock.calls[0][0].auth as InstanceType<
      typeof gmailAuth.OAuth2
    >;
    expect(auth.credentials.refresh_token).toBe('gmail-private-refresh-token');
    expect(auth.transporter.defaults).toMatchObject({
      timeout: 10000,
      retry: false,
    });
  });
  it('does not require or interpret Authorization or associate a visitor with an account', async () => {
    await post(app)
      .set('Authorization', 'Bearer example-signed-in-token')
      .expect(200);
    await post(app).set('Authorization', 'Bearer invalid-token').expect(200);
    expect(sendGmail).toHaveBeenCalledTimes(2);
  });
  it('preserves Burmese headers and multiline plain-text content', async () => {
    const body = {
      ...input,
      name: 'မောင်မောင်',
      subject: 'မင်္ဂလာပါ',
      message: 'မင်္ဂလာပါ BlogHub\nကျေးဇူးတင်ပါတယ်',
    };
    await post(app, body).expect(200);
    const mime = Buffer.from(
      sendGmail.mock.calls[0][0].requestBody.raw,
      'base64url',
    ).toString('utf8');
    const [headers, encodedBody] = mime.split('\r\n\r\n');
    // Unfold and decode RFC 2047 base64 words emitted by the existing MIME builder.
    const decodedHeaders = headers
      .replace(/\r\n[ \t]+/g, ' ')
      .replace(/\?=\s+=\?/g, '?==?')
      .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, part: string) =>
        Buffer.from(part, 'base64').toString('utf8'),
      );
    expect(decodedHeaders).toContain(
      `Subject: [BlogHub Contact] ${body.subject}`,
    );
    expect(decodedHeaders).toContain(`Reply-To: ${body.name} <${body.email}>`);
    const text = Buffer.from(encodedBody, 'base64')
      .toString('utf8')
      .replace(/\r\n/g, '\n');
    expect(text).toContain(
      `Sender: ${body.name}\nEmail: ${body.email}\nSubject: ${body.subject}\n\n${body.message}`,
    );
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
    expect(sendGmail).not.toHaveBeenCalled();
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
      expect(sendGmail).not.toHaveBeenCalled();
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
    expect(sendGmail).toHaveBeenCalledOnce();
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
        /private|test-private-secret|gmail-private-refresh-token/,
      );
      expect(sendGmail).not.toHaveBeenCalled();
      expect(
        vi.mocked(Logger.prototype.warn).mock.calls.flat().join(' '),
      ).not.toMatch(/private|fresh-google-token/);
    },
  );
  it.each([
    'invalid_client',
    'invalid_grant',
    'quota',
    'timeout',
    'unavailable',
    'unacknowledged',
  ])('does not claim delivery on Gmail %s failure', async (kind) => {
    if (kind === 'unacknowledged') sendGmail.mockResolvedValue({ data: {} });
    else
      sendGmail.mockRejectedValue(
        Object.assign(new Error('gmail-private-refresh-token'), { code: kind }),
      );
    const result = await post(app).expect(503);
    expect(result.body.message).toBe(
      'Your message could not be sent. Please try again with a new CAPTCHA.',
    );
    expect(JSON.stringify(result.body)).not.toMatch(/gmail-private|saved/);
    expect(sendGmail).toHaveBeenCalledOnce();
    expect(vi.mocked(Logger.prototype.error).mock.calls.flat().join(' ')).toBe(
      'Contact email delivery failed',
    );
  });
  it('fails closed when reCAPTCHA configuration is missing', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');
    await post(app).expect(503);
    expect(sendGmail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(sendGmail).toHaveBeenCalledTimes(3);
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
