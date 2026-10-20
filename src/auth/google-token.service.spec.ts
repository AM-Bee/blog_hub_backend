import { OAuth2Client } from 'google-auth-library';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleTokenService } from './google-token.service.js';

const verify = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken');
const claims = {
  sub: 'google-user-123',
  email: 'Writer@Example.com',
  email_verified: true,
  name: '  Writer  ',
};

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'our-client.apps.googleusercontent.com');
  verify.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it('passes the expected audience to Google verification and uses only verified claims', async () => {
  verify.mockResolvedValue({ getPayload: () => claims } as never);
  expect(await new GoogleTokenService().verify('signed-id-token')).toEqual({
    subject: claims.sub,
    email: 'writer@example.com',
    displayName: 'Writer',
  });
  expect(verify).toHaveBeenCalledWith({
    idToken: 'signed-id-token',
    audience: 'our-client.apps.googleusercontent.com',
  });
});

it('disables only Google login when configuration is absent', async () => {
  vi.stubEnv('GOOGLE_CLIENT_ID', '');
  await expect(new GoogleTokenService().verify('token')).rejects.toBeInstanceOf(
    ServiceUnavailableException,
  );
  expect(verify).not.toHaveBeenCalled();
});

it('rejects signature, audience, issuer, or expiry verification failures', async () => {
  verify.mockRejectedValue(new Error('verification failed'));
  await expect(new GoogleTokenService().verify('token')).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
});

it.each([
  undefined,
  { ...claims, sub: '' },
  { ...claims, email_verified: false },
  { ...claims, email_verified: undefined },
  { ...claims, email: 'not-an-email' },
])('rejects missing or unverified identity claims: %j', async (payload) => {
  verify.mockResolvedValue({ getPayload: () => payload } as never);
  await expect(new GoogleTokenService().verify('token')).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
});
