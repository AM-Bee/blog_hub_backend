import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthService } from '../auth/auth.service.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { validateDto } from '../common/validation.utils.js';
import { ToggleReactionDto } from './dto/reaction.dto.js';

it.each(['like', 'dislike'])('accepts reaction %s', async (type) => {
  await expect(validateDto({ type }, ToggleReactionDto)).resolves.toMatchObject(
    { type },
  );
});
it.each([
  {},
  { type: 'love' },
  { type: 'LIKE' },
  { type: null },
  { type: 1 },
  { type: 'like', userId: 'spoofed' },
  { type: 'like', blogId: 'spoofed' },
])('rejects invalid reaction input %j', async (body) => {
  await expect(validateDto(body, ToggleReactionDto)).rejects.toThrow();
});
function context(authorization?: string) {
  const request = { headers: { authorization }, user: undefined };
  const execution = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
  return { request, execution };
}
it('allows anonymous summary reads only when the Authorization header is missing', async () => {
  const authenticateSession = vi.fn();
  const guard = new OptionalJwtAuthGuard({
    authenticateSession,
  } as unknown as AuthService);
  expect(await guard.canActivate(context().execution)).toBe(true);
  expect(authenticateSession).not.toHaveBeenCalled();
  for (const header of ['', 'Basic abc', 'Bearer ']) {
    await expect(
      guard.canActivate(context(header).execution),
    ).rejects.toThrow();
  }
});
it('uses existing auth for supplied tokens and never silently ignores invalid credentials', async () => {
  const authenticateSession = vi
    .fn()
    .mockResolvedValueOnce({ user: { id: 'user' }, sessionId: 'session' })
    .mockRejectedValueOnce(new Error('Expired session'));
  const guard = new OptionalJwtAuthGuard({
    authenticateSession,
  } as unknown as AuthService);
  const valid = context('Bearer token');
  expect(await guard.canActivate(valid.execution)).toBe(true);
  expect(valid.request.user).toEqual({ id: 'user' });
  await expect(
    guard.canActivate(context('Bearer expired').execution),
  ).rejects.toThrow('Expired session');
});
