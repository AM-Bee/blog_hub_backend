import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { isEmail } from 'class-validator';

@Injectable()
export class GoogleTokenService {
  private readonly client = new OAuth2Client();

  async verify(idToken: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      throw new ServiceUnavailableException('Google login is not configured');
    }

    try {
      // The library checks Google's signature, issuer, audience, and expiry.
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const identity = ticket.getPayload();
      if (
        !identity?.sub ||
        identity.sub.length > 255 ||
        identity.email_verified !== true ||
        !identity.email ||
        identity.email.length > 254 ||
        !isEmail(identity.email)
      ) {
        throw new Error('Missing verified Google identity');
      }
      return {
        subject: identity.sub,
        email: identity.email.trim().toLowerCase(),
        displayName: [...(identity.name?.trim() || 'Google User')]
          .slice(0, 100)
          .join(''),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired Google ID token');
    }
  }
}
