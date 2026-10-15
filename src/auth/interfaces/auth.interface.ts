import type { User } from '../../users/interfaces/user.interface.js';

export type AuthUser = User;

export interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
}

export interface AuthTokens extends AccessTokenResponse {
  refreshToken: string;
  expiresAt: Date;
}
