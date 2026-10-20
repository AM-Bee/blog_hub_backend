import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleTokenService } from './google-token.service.js';

// Exercise the real Google verifier against local RSA fixtures, without network calls.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const audience = 'bloghub-client.apps.googleusercontent.com';
const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: 'https://accounts.google.com',
  aud: audience,
  sub: 'google-subject',
  iat: now,
  exp: now + 3600,
  email: 'writer@example.com',
  email_verified: true,
};
function token(payload = claims) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'test-key' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(
    'sha256',
    Buffer.from(`${header}.${body}`),
    privateKey,
  ).toString('base64url');
  return `${header}.${body}.${signature}`;
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', audience);
  vi.spyOn(
    OAuth2Client.prototype,
    'getFederatedSignonCertsAsync',
  ).mockResolvedValue({
    certs: {
      'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
    format: 'PEM',
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('accepts a correctly signed Google identity with the configured audience', async () => {
  expect(await new GoogleTokenService().verify(token())).toMatchObject({
    subject: claims.sub,
    email: claims.email,
  });
});
it.each([
  { ...claims, aud: 'some-other-app' },
  { ...claims, iss: 'https://attacker.example.com' },
  { ...claims, iat: now - 7200, exp: now - 3600 },
  { ...claims, email_verified: false },
])(
  'rejects cryptographically signed but unacceptable claims: %j',
  async (payload) => {
    await expect(
      new GoogleTokenService().verify(token(payload)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  },
);
it('rejects an identity modified after signing', async () => {
  const parts = token().split('.');
  parts[1] = Buffer.from(
    JSON.stringify({ ...claims, email: 'victim@example.com' }),
  ).toString('base64url');
  await expect(
    new GoogleTokenService().verify(parts.join('.')),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});
