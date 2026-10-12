import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../auth/auth.controller.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UsersService } from './users.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import type { Response } from 'express';

describe('Account routes', () => {
  it('requires JWT authentication for profile and password changes', () => {
    for (const handler of [
      AuthController.prototype.updateProfile,
      AuthController.prototype.changePassword,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        JwtAuthGuard,
      );
    }
  });
  it('uses the signed-in identity and clears the refresh cookie after password changes', async () => {
    const users = {
      updateProfile: vi.fn().mockResolvedValue({ displayName: 'Name' }),
    } as unknown as UsersService;
    const auth = {
      changePassword: vi.fn().mockResolvedValue({ message: 'Changed' }),
    } as unknown as AuthService;
    const controller = new AuthController(
      auth,
      { secret: 'test', frontendOrigins: [], secureCookies: false },
      users,
    );
    const request = { user: { id: 'signed-in-id' } } as AuthenticatedRequest;
    const response = { clearCookie: vi.fn() } as unknown as Response;
    await controller.updateProfile({ displayName: 'Name' }, request);
    expect(users.updateProfile).toHaveBeenCalledWith('signed-in-id', {
      displayName: 'Name',
    });
    const dto = { currentPassword: 'old', newPassword: 'new-password' };
    await controller.changePassword(dto, request, response);
    expect(auth.changePassword).toHaveBeenCalledWith('signed-in-id', dto);
    expect(response.clearCookie).toHaveBeenCalledWith(
      'bloghub_refresh',
      expect.objectContaining({ path: '/api/v1/auth', httpOnly: true }),
    );
  });
});
