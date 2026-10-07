export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');
export const REFRESH_COOKIE = 'bloghub_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const SESSION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

export interface AuthOptions {
  secret: string;
  frontendOrigins: string[];
  secureCookies: boolean;
}

export function frontendOrigins(): string[] {
  const origins = (process.env.FRONTEND_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim());
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(
        'FRONTEND_ORIGINS must contain comma-separated HTTP(S) origins without paths',
      );
    }
  }
  return origins;
}

export function authOptions(): AuthOptions {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(
      'Set JWT_SECRET to a random secret of at least 32 bytes before starting BlogHub',
    );
  }
  return {
    secret,
    frontendOrigins: frontendOrigins(),
    secureCookies: process.env.NODE_ENV === 'production',
  };
}
