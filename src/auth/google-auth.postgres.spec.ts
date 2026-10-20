import 'reflect-metadata';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageService } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthModule } from './auth.module.js';
import { GoogleTokenService } from './google-token.service.js';
import { PasswordResetMailService } from './password-reset-mail.service.js';
import { AuthAccountEntity } from './entities/auth-account.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { seedEntities } from '../seed.js';
import { AddGoogleAccounts1792454400000 } from '../database/migrations/1792454400000-AddGoogleAccounts.js';

// Only a new, random schema is written. Never point synchronize at application tables.
const schema = `google_test_${randomUUID().replaceAll('-', '')}`;
let database: DataSource;
let adminDatabase: DataSource;
let app: INestApplication;
const verify = vi.fn();
const sendCode = vi.fn();
@Global()
@Module({
  providers: [{ provide: DataSource, useFactory: () => database }],
  exports: [DataSource],
})
class TestDatabaseModule {}

// These are verified identities supplied by a mocked Google boundary, not real OAuth tokens.
const identities: Record<
  string,
  { subject: string; email: string; displayName: string }
> = {
  fresh: {
    subject: 'google-fresh',
    email: 'google@example.com',
    displayName: 'Google Writer',
  },
  local: {
    subject: 'google-local',
    email: 'local@example.com',
    displayName: 'Local Google',
  },
  race: {
    subject: 'google-race',
    email: 'race@example.com',
    displayName: 'Concurrent Writer',
  },
};
const origin = 'http://localhost:3000';
const googleLogin = (idToken = 'fresh') =>
  request(app.getHttpServer())
    .post('/api/v1/auth/google')
    .set('Origin', origin)
    .send({ idToken });
const login = (email: string, password = 'Password123!') =>
  request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .send({ email, password });
const me = (token: string) =>
  request(app.getHttpServer())
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${token}`);
const cookie = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])[0].split(';')[0];

// SMTP and Google verification are mocked; session signing, hashing, guards, DB, and transactions are real.
describe.runIf(process.env.BLOGHUB_RUN_DB_TESTS === '1')(
  'Google auth PostgreSQL and HTTP',
  () => {
    beforeAll(async () => {
      dotenv.config({ quiet: true });
      vi.stubEnv('JWT_SECRET', 'google-test-secret-at-least-32-bytes-long');
      vi.stubEnv('FRONTEND_ORIGINS', origin);
      const connection = {
        type: 'postgres' as const,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5433),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        installExtensions: false,
        connectTimeoutMS: 5000,
      };
      adminDatabase = await new DataSource(connection).initialize();
      await adminDatabase.query(`CREATE SCHEMA "${schema}"`);
      database = await new DataSource({
        ...connection,
        schema,
        entities: [...seedEntities, AuthAccountEntity],
        synchronize: true,
      }).initialize();
      verify.mockImplementation(async (token: string) => identities[token]);
      const module = await Test.createTestingModule({
        imports: [TestDatabaseModule, AuthModule],
      })
        .overrideProvider(GoogleTokenService)
        .useValue({ verify })
        .overrideProvider(PasswordResetMailService)
        .useValue({ ensureConfigured() {}, sendCode })
        .compile();
      app = module.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.use(cookieParser());
      await app.init();
    }, 30000);
    beforeEach(() => {
      // Each scenario gets a fresh rate-limit window; guards remain enabled.
      app
        .get<ThrottlerStorageService>(ThrottlerStorage)
        .onApplicationShutdown();
    });
    afterAll(async () => {
      await app?.close();
      if (database?.isInitialized) await database.destroy();
      if (adminDatabase?.isInitialized) {
        await adminDatabase.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await adminDatabase.destroy();
      }
      vi.unstubAllEnvs();
    });

    it('registers a passwordless author and returns safe JSON plus an HttpOnly refresh cookie', async () => {
      const response = await googleLogin().expect(200);
      expect(response.body).toEqual({
        accessToken: expect.any(String),
        expiresIn: 3600,
      });
      expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
      expect(response.headers['set-cookie'][0]).toContain('Path=/api/v1/auth');
      const profile = await me(response.body.accessToken).expect(200);
      expect(profile.body).toMatchObject({
        email: identities.fresh.email,
        role: 'author',
      });
      expect(profile.body).not.toHaveProperty('passwordHash');
      const user = await database
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :id', { id: profile.body.id })
        .getOneOrFail();
      expect(user.passwordHash).toBeNull();
      await login(user.email).expect(401);
    });

    it('uses refresh rotation and invalidates access tokens on logout', async () => {
      const response = await googleLogin().expect(200);
      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', cookie(response))
        .expect(200);
      expect(cookie(refreshed)).not.toBe(cookie(response));
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', origin)
        .set('Cookie', cookie(refreshed))
        .expect(200);
      await me(response.body.accessToken).expect(401);
    });

    it('preserves local login and requires password proof before linking an existing email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          displayName: 'Local Writer',
          email: identities.local.email,
          password: 'Password123!',
        })
        .expect(201);
      const conflict = await googleLogin('local').expect(409);
      expect(conflict.body.code).toBe('GOOGLE_LINK_REQUIRED');
      const response = await login(identities.local.email).expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/google/link')
        .send({ idToken: 'local', currentPassword: 'Password123!' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .send({ idToken: 'local', currentPassword: 'wrong' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .send({ idToken: 'local', currentPassword: 'Password123!' })
        .expect(200);
      const google = await googleLogin('local').expect(200);
      const before = await me(response.body.accessToken).expect(200);
      const after = await me(google.body.accessToken).expect(200);
      expect(after.body.id).toBe(before.body.id);
      expect(after.body.displayName).toBe('Local Writer');
      await login(identities.local.email).expect(200);
    });

    it('resolves linked subjects after email edits and blocks disabled accounts', async () => {
      const response = await login(identities.local.email).expect(200);
      const profile = await me(response.body.accessToken).expect(200);
      await request(app.getHttpServer())
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .send({ email: 'changed@example.com', currentPassword: 'Password123!' })
        .expect(200);
      const google = await googleLogin('local').expect(200);
      expect((await me(google.body.accessToken).expect(200)).body.email).toBe(
        'changed@example.com',
      );
      await database
        .getRepository(UserEntity)
        .update(profile.body.id, { status: UserStatus.DISABLED });
      await googleLogin('local').expect(401);
      await me(google.body.accessToken).expect(401);
    });

    it('allows Google-only accounts to establish a password through verified recovery', async () => {
      const response = await googleLogin().expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: identities.fresh.email })
        .expect(200);
      const code = sendCode.mock.calls.at(-1)![1];
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({
          email: identities.fresh.email,
          code,
          newPassword: 'FirstPassword123!',
        })
        .expect(200);
      await me(response.body.accessToken).expect(401);
      await login(identities.fresh.email, 'FirstPassword123!').expect(200);
      await googleLogin().expect(200);
    });

    it('prevents duplicate accounts during simultaneous first logins', async () => {
      const results = await Promise.all([
        googleLogin('race'),
        googleLogin('race'),
      ]);
      expect(
        results.every((result) => [200, 409].includes(result.status)),
      ).toBe(true);
      expect(results.some((result) => result.status === 200)).toBe(true);
      expect(
        await database
          .getRepository(UserEntity)
          .countBy({ email: identities.race.email }),
      ).toBe(1);
      expect(
        await database
          .getRepository(AuthAccountEntity)
          .countBy({ providerAccountId: identities.race.subject }),
      ).toBe(1);
    });

    it('requires an allowed Origin and rejects extra identity fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/google')
        .send({ idToken: 'fresh' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/auth/google')
        .set('Origin', origin)
        .send({ idToken: 'fresh', email: 'fake@example.com', role: 'admin' })
        .expect(400);
    });

    it('applies the incremental migration without losing existing users and rejects passwordless rollback', async () => {
      const runner = database.createQueryRunner();
      const migration = new AddGoogleAccounts1792454400000();
      const before = await database.getRepository(UserEntity).count();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SET LOCAL search_path TO "${schema}", public`);
        await migration.up(runner);
        expect(await runner.manager.getRepository(UserEntity).count()).toBe(
          before,
        );
        // Also exercise creation on an older schema, inside this rolled-back test transaction.
        await runner.query('DROP TABLE auth_accounts');
        await migration.up(runner);
        await migration.up(runner);
        const indexes = await runner.query(
          'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
          [schema, 'auth_accounts'],
        );
        expect(
          indexes.map((row: { indexname: string }) => row.indexname),
        ).toEqual(
          expect.arrayContaining([
            'UQ_auth_accounts_provider_identity',
            'UQ_auth_accounts_user_provider',
          ]),
        );
        // The recovery test has set the first account's password; keep a null fixture for rollback.

        await runner.query(
          'UPDATE users SET password_hash = NULL WHERE email = $1',
          [identities.race.email],
        );
        await expect(migration.down(runner)).rejects.toThrow();
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  },
);
