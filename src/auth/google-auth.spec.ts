import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import type { EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { UsersService } from '../users/users.service.js';
import { GoogleTokenService } from './google-token.service.js';
import { PasswordResetMailService } from './password-reset-mail.service.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { AuthAccountEntity } from './entities/auth-account.entity.js';
import { RefreshSessionEntity } from './entities/refresh-session.entity.js';
import { RefreshTokenEntity } from './entities/refresh-token.entity.js';

const identity = {
  subject: 'google-123',
  email: 'writer@example.com',
  displayName: 'Google Writer',
};
let service: AuthService;
let passwordHash: string;
const user = () => ({
  id: 'existing-user',
  email: identity.email,
  displayName: 'Existing Writer',
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  passwordHash,
});
const manager = { create: vi.fn(), save: vi.fn() };
const repository = {
  transaction: vi.fn(),
  findGoogleAccount: vi.fn(),
  findLockedUserByEmail: vi.fn(),
  findLockedUserById: vi.fn(),
};
const google = { verify: vi.fn() };
const jwt = { signAsync: vi.fn() };

beforeAll(async () => {
  passwordHash = await bcrypt.hash('Password123!', 4);
});
beforeEach(() => {
  vi.resetAllMocks();
  repository.transaction.mockImplementation((work) =>
    work(manager as unknown as EntityManager),
  );
  repository.findGoogleAccount.mockResolvedValue(null);
  repository.findLockedUserByEmail.mockResolvedValue(null);
  repository.findLockedUserById.mockResolvedValue(user());
  manager.create.mockImplementation((_entity, input) => input);
  manager.save.mockImplementation(async (entity, input) =>
    entity === UserEntity ? { id: 'new-user', ...input } : input,
  );
  google.verify.mockResolvedValue(identity);
  jwt.signAsync.mockResolvedValue('application-jwt');
  service = new AuthService(
    {} as UsersService,
    jwt as unknown as JwtService,
    repository as unknown as AuthRepository,
    {} as PasswordResetMailService,
    google as unknown as GoogleTokenService,
  );
});

it('creates a password-enabled author, provider link, and the normal hashed refresh session', async () => {
  const result = await service.googleLogin({
    idToken: 'google-id-token',
    password: 'Password123!',
  });
  expect(manager.save).toHaveBeenCalledWith(
    UserEntity,
    expect.objectContaining({
      email: identity.email,
      passwordHash: expect.stringMatching(/^\$2/),
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
    }),
  );
  const savedUser = manager.save.mock.calls.find(
    ([entity]) => entity === UserEntity,
  )![1];
  expect(await bcrypt.compare('Password123!', savedUser.passwordHash)).toBe(
    true,
  );
  expect(manager.save).toHaveBeenCalledWith(
    AuthAccountEntity,
    expect.objectContaining({
      userId: 'new-user',
      provider: 'google',
      providerAccountId: identity.subject,
    }),
  );
  expect(manager.save).toHaveBeenCalledWith(
    RefreshSessionEntity,
    expect.objectContaining({ userId: 'new-user', revokedAt: null }),
  );
  expect(manager.save).toHaveBeenCalledWith(
    RefreshTokenEntity,
    expect.objectContaining({
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      usedAt: null,
    }),
  );
  expect(result).toMatchObject({
    accessToken: 'application-jwt',
    expiresIn: 3600,
  });
  expect(result.refreshToken).toMatch(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
});

it('does not create an account or session before the new user sets a password', async () => {
  const failure = await service
    .googleLogin({ idToken: 'token' })
    .catch((error) => error);
  expect(failure.getResponse()).toMatchObject({
    code: 'GOOGLE_REGISTRATION_REQUIRED',
  });
  expect(manager.save).not.toHaveBeenCalled();
});

it('uses registration password rules and rejects weak or oversized UTF-8 passwords', async () => {
  for (const password of ['short', 'က'.repeat(25)]) {
    await expect(
      service.googleLogin({ idToken: 'token', password }),
    ).rejects.toBeInstanceOf(BadRequestException);
  }
  expect(manager.save).not.toHaveBeenCalled();
});

it('links an existing email after password proof and keeps its admin role and password', async () => {
  repository.findLockedUserByEmail.mockResolvedValue(user());
  await service.googleLogin({ idToken: 'token', password: 'Password123!' });
  expect(manager.save).not.toHaveBeenCalledWith(UserEntity, expect.anything());
  expect(manager.save).toHaveBeenCalledWith(
    AuthAccountEntity,
    expect.objectContaining({ userId: 'existing-user' }),
  );
  expect(jwt.signAsync).toHaveBeenCalledWith(
    { sub: 'existing-user', sid: expect.any(String) },
    expect.anything(),
  );
});

it('never links an existing email when the password is wrong', async () => {
  repository.findLockedUserByEmail.mockResolvedValue(user());
  await expect(
    service.googleLogin({ idToken: 'token', password: 'incorrect' }),
  ).rejects.toBeInstanceOf(UnauthorizedException);
  expect(manager.save).not.toHaveBeenCalled();
});

it('prepares new, existing, and linked accounts without writing or creating sessions', async () => {
  expect(await service.prepareGoogle({ idToken: 'token' })).toMatchObject({
    step: 'register',
    email: identity.email,
  });
  repository.findLockedUserByEmail.mockResolvedValue(user());
  expect(await service.prepareGoogle({ idToken: 'token' })).toMatchObject({
    step: 'link',
  });
  repository.findGoogleAccount.mockResolvedValue({ userId: 'existing-user' });
  expect(await service.prepareGoogle({ idToken: 'token' })).toMatchObject({
    step: 'login',
  });
  expect(manager.save).not.toHaveBeenCalled();
  expect(jwt.signAsync).not.toHaveBeenCalled();
});

it('uses an existing provider link without rematching or overwriting the application account', async () => {
  repository.findGoogleAccount.mockResolvedValue({ userId: 'existing-user' });
  await service.googleLogin({ idToken: 'token' });
  expect(repository.findLockedUserByEmail).not.toHaveBeenCalled();
  expect(manager.save).not.toHaveBeenCalledWith(UserEntity, expect.anything());
  expect(jwt.signAsync).toHaveBeenCalledWith(
    { sub: 'existing-user', sid: expect.any(String) },
    expect.anything(),
  );
});

it('requires explicit linking when an email already exists', async () => {
  repository.findLockedUserByEmail.mockResolvedValue(user());
  const error = await service
    .googleLogin({ idToken: 'token' })
    .catch((failure) => failure);
  expect(error).toBeInstanceOf(ConflictException);
  expect(error.getResponse()).toMatchObject({ code: 'GOOGLE_LINK_REQUIRED' });
  expect(manager.save).not.toHaveBeenCalled();
});

it('rejects disabled linked users without creating a session', async () => {
  repository.findGoogleAccount.mockResolvedValue({ userId: 'existing-user' });
  repository.findLockedUserById.mockResolvedValue({
    ...user(),
    status: UserStatus.DISABLED,
  });
  await expect(
    service.googleLogin({ idToken: 'token' }),
  ).rejects.toBeInstanceOf(UnauthorizedException);
  expect(manager.save).not.toHaveBeenCalled();
});

it('links only after current-password proof and does not replace the user or issue a new session', async () => {
  await service.linkGoogle('existing-user', {
    idToken: 'token',
    currentPassword: 'Password123!',
  });
  expect(manager.save).toHaveBeenCalledTimes(1);
  expect(manager.save).toHaveBeenCalledWith(AuthAccountEntity, {
    userId: 'existing-user',
    provider: 'google',
    providerAccountId: identity.subject,
  });
});

it.each([null, 'wrong-password'])(
  'rejects linking with no local password or the wrong password: %s',
  async (value) => {
    repository.findLockedUserById.mockResolvedValue({
      ...user(),
      passwordHash: value,
    });
    await expect(
      service.linkGoogle('existing-user', {
        idToken: 'token',
        currentPassword: 'Password123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(manager.save).not.toHaveBeenCalled();
  },
);

it('does not link an identity belonging to another user', async () => {
  repository.findGoogleAccount.mockResolvedValue({ userId: 'another-user' });
  await expect(
    service.linkGoogle('existing-user', {
      idToken: 'token',
      currentPassword: 'Password123!',
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(manager.save).not.toHaveBeenCalled();
});

it('requires matching emails for a new link', async () => {
  google.verify.mockResolvedValue({ ...identity, email: 'other@example.com' });
  await expect(
    service.linkGoogle('existing-user', {
      idToken: 'token',
      currentPassword: 'Password123!',
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
});

it('allows retrying the same link without inserting another record', async () => {
  repository.findGoogleAccount.mockResolvedValue({ userId: 'existing-user' });
  await service.linkGoogle('existing-user', {
    idToken: 'token',
    currentPassword: 'Password123!',
  });
  expect(manager.save).not.toHaveBeenCalled();
});

it('handles database uniqueness races as conflicts instead of server errors', async () => {
  repository.transaction.mockRejectedValue(
    new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('duplicate'), {
        code: '23505',
        constraint: 'UQ_users_email',
      }),
    ),
  );
  await expect(
    service.googleLogin({ idToken: 'token' }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('keeps password login issuing the same application tokens', async () => {
  repository.findLockedUserByEmail.mockResolvedValue(user());
  expect(
    await service.login({ email: identity.email, password: 'Password123!' }),
  ).toMatchObject({ accessToken: 'application-jwt', expiresIn: 3600 });
});

it('rejects password login and change-password for passwordless users without bcrypt errors', async () => {
  repository.findLockedUserByEmail.mockResolvedValue({
    ...user(),
    passwordHash: null,
  });
  repository.findLockedUserById.mockResolvedValue({
    ...user(),
    passwordHash: null,
  });
  await expect(
    service.login({ email: identity.email, password: 'Password123!' }),
  ).rejects.toBeInstanceOf(UnauthorizedException);
  await expect(
    service.changePassword('existing-user', {
      currentPassword: 'Password123!',
      newPassword: 'NewPassword123!',
    }),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});

it('rejects client-supplied identity/role fields and failed verification before database writes', async () => {
  await expect(
    service.googleLogin({ idToken: 'token', email: identity.email } as never),
  ).rejects.toBeInstanceOf(BadRequestException);
  google.verify.mockRejectedValue(new UnauthorizedException());
  await expect(
    service.googleLogin({ idToken: 'bad-token' }),
  ).rejects.toBeInstanceOf(UnauthorizedException);
  expect(repository.transaction).not.toHaveBeenCalled();
});
