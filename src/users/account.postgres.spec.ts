import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersRepository } from './users.repository.js';
import { UserEntity } from './entities/user.entity.js';
import { UserRole } from './enums/user-role.enum.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity.js';
import { PasswordResetMailService } from '../auth/password-reset-mail.service.js';

// Only test tables in a uniquely named schema are created/truncated/removed.
describe.skipIf(process.env.BLOGHUB_RUN_DB_TESTS !== '1')(
  'Account changes against PostgreSQL',
  () => {
    const schema = `bloghub_account_test_${randomUUID().replaceAll('-', '')}`;
    let client: pg.Client;
    let ds: DataSource;
    let createdSchema = false;
    let users: UsersService;
    let auth: AuthService;
    let user: UserEntity;
    const password = 'OldPassword123!';
    const newPassword = 'NewPassword123!';
    const mail = {
      ensureConfigured: vi.fn(),
      sendCode: vi.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
      dotenv.config({ quiet: true });
      const connection = {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5433),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionTimeoutMillis: 5000,
      };
      client = new pg.Client(connection);
      await client.connect();
      await client.query(`CREATE SCHEMA "${schema}"`);
      createdSchema = true;
      ds = new DataSource({
        type: 'postgres',
        host: connection.host,
        port: connection.port,
        username: connection.user,
        password: connection.password,
        database: connection.database,
        schema,
        entities: [UserEntity, RefreshSessionEntity, RefreshTokenEntity],
        synchronize: true,
        installExtensions: false,
      });
      await ds.initialize();
      users = new UsersService(
        new UsersRepository(ds.getRepository(UserEntity)),
      );
      auth = new AuthService(
        users,
        new JwtService({
          secret: 'test-secret-at-least-32-bytes-for-accounts',
        }),
        new AuthRepository(ds, ds.getRepository(RefreshSessionEntity)),
        mail as unknown as PasswordResetMailService,
      );
    }, 30000);
    beforeEach(async () => {
      mail.sendCode.mockReset().mockResolvedValue(undefined);
      await ds.query(`TRUNCATE TABLE "${schema}".users CASCADE`);
      user = await ds.getRepository(UserEntity).save({
        displayName: 'Original',
        email: 'original@example.com',
        passwordHash: await bcrypt.hash(password, 10),
        role: UserRole.AUTHOR,
      });
    });
    afterAll(async () => {
      if (ds?.isInitialized) await ds.destroy();
      if (createdSchema) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client?.end();
    }, 30000);

    it('updates the own display name and returns only safe profile fields', async () => {
      const result = await users.updateProfile(user.id, {
        displayName: ' New Name ',
      });
      expect(result.displayName).toBe('New Name');
      expect(result.email).toBe(user.email);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.role).toBe(UserRole.AUTHOR);
      await expect(users.updateProfile(user.id, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('requires the current password for email changes and permits normalized unchanged email', async () => {
      for (const input of [
        { email: 'new@example.com' },
        { email: 'new@example.com', currentPassword: 'wrong' },
      ]) {
        await expect(
          users.updateProfile(user.id, input),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(
        (
          await users.updateProfile(user.id, {
            email: ' ORIGINAL@EXAMPLE.COM ',
          })
        ).email,
      ).toBe(user.email);
      const result = await users.updateProfile(user.id, {
        email: ' NEW@EXAMPLE.COM ',
        currentPassword: password,
      });
      expect(result.email).toBe('new@example.com');
      await expect(
        auth.login({ email: user.email, password }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        await auth.login({ email: result.email, password }),
      ).toHaveProperty('accessToken');
    });

    it('rejects duplicate email atomically and cannot change role or passwords through profile updates', async () => {
      await ds.getRepository(UserEntity).save({
        email: 'other@example.com',
        displayName: 'Other',
        passwordHash: await bcrypt.hash(password, 10),
        role: UserRole.ADMIN,
      });
      await expect(
        users.updateProfile(user.id, {
          displayName: 'Should rollback',
          email: 'OTHER@EXAMPLE.COM',
          currentPassword: password,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((await users.findOne(user.id)).displayName).toBe('Original');
      await expect(
        users.updateProfile(user.id, { role: 'admin' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await users.findOne(user.id)).role).toBe(UserRole.AUTHOR);
    });

    it('rejects an incorrect current password without changing the password or sessions', async () => {
      const login = await auth.login({ email: user.email, password });
      await expect(
        auth.changePassword(user.id, { currentPassword: 'wrong', newPassword }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await auth.authenticate(login.accessToken)).id).toBe(user.id);
      expect(await auth.login({ email: user.email, password })).toHaveProperty(
        'accessToken',
      );
    });

    it('changes the hash, revokes every own session, and preserves other users sessions', async () => {
      const first = await auth.login({ email: user.email, password });
      const second = await auth.login({ email: user.email, password });
      const other = await ds.getRepository(UserEntity).save({
        email: 'other@example.com',
        displayName: 'Admin',
        role: UserRole.ADMIN,
        passwordHash: await bcrypt.hash(password, 10),
      });
      const otherLogin = await auth.login({ email: other.email, password });
      await auth.changePassword(user.id, {
        currentPassword: password,
        newPassword,
      });
      const saved = await ds
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :id', { id: user.id })
        .getOneOrFail();
      expect(saved.passwordHash).not.toBe(newPassword);
      expect(await bcrypt.compare(newPassword, saved.passwordHash)).toBe(true);
      for (const login of [first, second]) {
        await expect(
          auth.authenticate(login.accessToken),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(auth.refresh(login.refreshToken)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
      await expect(
        auth.login({ email: user.email, password }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        await auth.login({ email: user.email, password: newPassword }),
      ).toHaveProperty('accessToken');
      expect((await auth.authenticate(otherLogin.accessToken)).id).toBe(
        other.id,
      );
      expect(await auth.refresh(otherLogin.refreshToken)).toHaveProperty(
        'accessToken',
      );
    });

    it('emails only the registered address, hides account existence, and limits repeat emails', async () => {
      const result = await auth.forgotPassword({
        email: ' ORIGINAL@EXAMPLE.COM ',
      });
      const unknown = await auth.forgotPassword({
        email: 'unknown@example.com',
      });
      expect(unknown).toEqual(result);
      expect(mail.sendCode).toHaveBeenCalledWith(
        user.email,
        expect.stringMatching(/^\d{6}$/),
      );
      await auth.forgotPassword({ email: user.email });
      expect(mail.sendCode).toHaveBeenCalledTimes(1);
      const saved = await ds
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .addSelect('user.passwordResetCodeHash')
        .where('user.id = :id', { id: user.id })
        .getOneOrFail();
      expect(saved.passwordResetCodeHash).not.toBe(
        mail.sendCode.mock.calls[0][1],
      );
      expect(
        await bcrypt.compare(
          mail.sendCode.mock.calls[0][1],
          saved.passwordResetCodeHash!,
        ),
      ).toBe(true);
      expect(await users.findOne(user.id)).not.toHaveProperty(
        'passwordResetCodeHash',
      );
    });

    it('resets once, revokes sessions, and serializes concurrent use of a code', async () => {
      const login = await auth.login({ email: user.email, password });
      await auth.forgotPassword({ email: user.email });
      const dto = {
        email: user.email,
        code: mail.sendCode.mock.calls[0][1],
        newPassword,
      };
      const results = await Promise.allSettled([
        auth.resetPassword(dto),
        auth.resetPassword(dto),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      await expect(auth.authenticate(login.accessToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(auth.refresh(login.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(
        auth.login({ email: user.email, password }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        await auth.login({ email: user.email, password: newPassword }),
      ).toHaveProperty('accessToken');
      await expect(auth.resetPassword(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects expired codes and locks a code after five incorrect attempts', async () => {
      await auth.forgotPassword({ email: user.email });
      const code = mail.sendCode.mock.calls[0][1];
      const wrong = code === '000000' ? '000001' : '000000';
      for (let i = 0; i < 5; i++) {
        await expect(
          auth.resetPassword({ email: user.email, code: wrong, newPassword }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(
        auth.resetPassword({ email: user.email, code, newPassword }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await ds.manager.update(UserEntity, user.id, {
        passwordResetAttempts: 0,
        passwordResetExpiresAt: new Date(Date.now() - 1),
      });
      await expect(
        auth.resetPassword({ email: user.email, code, newPassword }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await auth.login({ email: user.email, password })).toHaveProperty(
        'accessToken',
      );
    });

    it('replaces old codes on resend and invalidates codes on profile email or password change', async () => {
      await auth.forgotPassword({ email: user.email });
      const firstCode = mail.sendCode.mock.calls[0][1];
      await ds.manager.update(UserEntity, user.id, {
        passwordResetExpiresAt: new Date(Date.now() + 13 * 60_000),
      });
      await auth.forgotPassword({ email: user.email });
      const secondCode = mail.sendCode.mock.calls[1][1];
      if (firstCode !== secondCode) {
        await expect(
          auth.resetPassword({
            email: user.email,
            code: firstCode,
            newPassword,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await users.updateProfile(user.id, {
        email: 'changed@example.com',
        currentPassword: password,
      });
      await expect(
        auth.resetPassword({
          email: 'changed@example.com',
          code: secondCode,
          newPassword,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await auth.forgotPassword({ email: 'changed@example.com' });
      const code = mail.sendCode.mock.calls[2][1];
      await auth.changePassword(user.id, {
        currentPassword: password,
        newPassword,
      });
      await expect(
        auth.resetPassword({
          email: 'changed@example.com',
          code,
          newPassword: password,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not save a new code or change passwords when delivery fails', async () => {
      mail.sendCode.mockRejectedValueOnce(new Error('SMTP failed'));
      await auth.forgotPassword({ email: user.email });
      const saved = await ds
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .addSelect('user.passwordResetCodeHash')
        .where('user.id = :id', { id: user.id })
        .getOneOrFail();
      expect(saved.passwordResetCodeHash).toBeNull();
      expect(await auth.login({ email: user.email, password })).toHaveProperty(
        'accessToken',
      );
    });

    it('serializes concurrent password changes so the old password can only be used once', async () => {
      const results = await Promise.allSettled([
        auth.changePassword(user.id, {
          currentPassword: password,
          newPassword: 'FirstPassword123!',
        }),
        auth.changePassword(user.id, {
          currentPassword: password,
          newPassword: 'SecondPassword123!',
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    });
  },
);
