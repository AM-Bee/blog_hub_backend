import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import request from 'supertest';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UserStatus } from '../users/enums/user-status.enum.js';
import { UsersService } from '../users/users.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { PasswordResetMailService } from '../auth/password-reset-mail.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity.js';
import { BlogEntity } from '../blogs/entities/blog.entity.js';
import { BlogStatus } from '../blogs/enums/blog-status.enum.js';
import { BlogTagEntity } from '../blogs/entities/blog-tag.entity.js';
import { BlogsService } from '../blogs/blogs.service.js';
import { BlogsRepository } from '../blogs/blogs.repository.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminUsersRepository } from './admin-users.repository.js';
import { AdminUsersController } from './admin-users.controller.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';

// Only a unique temporary schema is created/truncated/dropped. Mail is mocked.
describe.skipIf(process.env.BLOGHUB_RUN_DB_TESTS !== '1')(
  'Admin user management against PostgreSQL',
  () => {
    const schema = `bloghub_admin_test_${randomUUID().replaceAll('-', '')}`;
    let client: pg.Client;
    let ds: DataSource;
    let app: INestApplication;
    let createdSchema = false;
    let service: AdminUsersService;
    let auth: AuthService;
    let author: UserEntity;
    let admin: UserEntity;
    const password = 'TestPassword123!';
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
        entities: [
          UserEntity,
          RefreshSessionEntity,
          RefreshTokenEntity,
          BlogEntity,
          BlogTagEntity,
          CategoryEntity,
          TagEntity,
        ],
        synchronize: true,
        installExtensions: false,
      });
      await ds.initialize();
      const users = new UsersService(
        new UsersRepository(ds.getRepository(UserEntity)),
      );
      auth = new AuthService(
        users,
        new JwtService({ secret: 'admin-test-secret-at-least-32-bytes' }),
        new AuthRepository(ds, ds.getRepository(RefreshSessionEntity)),
        mail as unknown as PasswordResetMailService,
      );
      service = new AdminUsersService(
        new AdminUsersRepository(ds.getRepository(UserEntity)),
      );
      const module = await Test.createTestingModule({
        controllers: [AdminUsersController],
        providers: [
          { provide: AdminUsersService, useValue: service },
          { provide: AuthService, useValue: auth },
          JwtAuthGuard,
          RolesGuard,
        ],
      }).compile();
      app = module.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.listen(0, '127.0.0.1');
    }, 30_000);

    beforeEach(async () => {
      mail.sendCode.mockClear();
      await ds.query(`TRUNCATE TABLE "${schema}".users CASCADE`);
      const passwordHash = await bcrypt.hash(password, 10);
      author = await ds.getRepository(UserEntity).save({
        displayName: 'Bee Author',
        email: 'bee@example.com',
        passwordHash,
        role: UserRole.AUTHOR,
      });
      admin = await ds.getRepository(UserEntity).save({
        displayName: 'Admin',
        email: 'admin@example.com',
        passwordHash,
        role: UserRole.ADMIN,
      });
    });

    afterAll(async () => {
      await app?.close();
      if (ds?.isInitialized) await ds.destroy();
      if (createdSchema) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client?.end();
    }, 30_000);

    it('requires admin authentication for all three routes and validates inputs', async () => {
      const adminLogin = await auth.login({ email: admin.email, password });
      const authorLogin = await auth.login({ email: author.email, password });
      for (const token of [
        undefined,
        authorLogin.accessToken,
        adminLogin.accessToken,
      ]) {
        const expected = !token
          ? 401
          : token === authorLogin.accessToken
            ? 403
            : 200;
        const list = request(app.getHttpServer()).get('/api/v1/admin/users');
        const detail = request(app.getHttpServer()).get(
          `/api/v1/admin/users/${author.id}`,
        );
        const status = request(app.getHttpServer())
          .patch(`/api/v1/admin/users/${author.id}/status`)
          .send({ status: 'active' });
        if (token)
          for (const call of [list, detail, status])
            call.set('Authorization', `Bearer ${token}`);
        await list.expect(expected);
        await detail.expect(expected);
        await status.expect(expected);
      }
      await request(app.getHttpServer())
        .get('/api/v1/admin/users?limit=51')
        .set('Authorization', `Bearer ${adminLogin.accessToken}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/v1/admin/users/invalid')
        .set('Authorization', `Bearer ${adminLogin.accessToken}`)
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${author.id}/status`)
        .set('Authorization', `Bearer ${adminLogin.accessToken}`)
        .send({ status: 'disabled', role: 'admin' })
        .expect(400);
    });

    it('paginates, searches names/email literally, and combines role/status filters', async () => {
      const first = await service.findAll({ page: 1, limit: 1 });
      const second = await service.findAll({ page: 2, limit: 1 });
      expect(first).toMatchObject({ total: 2, totalPages: 2 });
      expect(first.items[0].id).not.toBe(second.items[0].id);
      for (const q of [' BEE ', 'BEE@EXAMPLE']) {
        const result = await service.findAll({ q } as ListUsersQueryDto);
        expect(result.items.map((user) => user.id)).toEqual([author.id]);
      }
      expect(
        (await service.findAll({ q: '%' } as ListUsersQueryDto)).total,
      ).toBe(0);
      expect(
        (await service.findAll({ q: '_' } as ListUsersQueryDto)).total,
      ).toBe(0);
      await service.updateStatus(author.id, { status: UserStatus.DISABLED });
      const filtered = await service.findAll({
        role: UserRole.AUTHOR,
        status: UserStatus.DISABLED,
      } as ListUsersQueryDto);
      expect(filtered.items.map((user) => user.id)).toEqual([author.id]);
      expect(
        (
          await service.findAll({
            role: UserRole.ADMIN,
            status: UserStatus.DISABLED,
          } as ListUsersQueryDto)
        ).total,
      ).toBe(0);
    });

    it('returns safe detail and counts both draft and published blogs without deleting content', async () => {
      await ds.getRepository(BlogEntity).save([
        {
          authorId: author.id,
          title: 'Published',
          content: 'Content',
          slug: 'published',
          status: BlogStatus.PUBLISHED,
          publishedAt: new Date(),
        },
        {
          authorId: author.id,
          title: 'Draft',
          content: 'Content',
          slug: 'draft',
          status: BlogStatus.DRAFT,
        },
      ]);
      expect(await service.findOne(author.id)).toMatchObject({
        blogCount: 2,
        status: UserStatus.ACTIVE,
      });
      await service.updateStatus(author.id, { status: UserStatus.DISABLED });
      const detail = await service.findOne(author.id);
      expect(detail).toMatchObject({
        blogCount: 2,
        status: UserStatus.DISABLED,
      });
      for (const field of [
        'passwordHash',
        'passwordResetCodeHash',
        'passwordResetExpiresAt',
        'passwordResetAttempts',
      ]) {
        expect(detail).not.toHaveProperty(field);
        expect(
          (await service.findAll({} as ListUsersQueryDto)).items[0],
        ).not.toHaveProperty(field);
      }
      const blogs = new BlogsService(
        new BlogsRepository(ds.getRepository(BlogEntity), ds),
      );
      expect(
        (await blogs.findAll({ page: 1, limit: 10 })).items.map(
          (blog) => blog.slug,
        ),
      ).toEqual(['published']);
    });

    it('revokes every author session and reset code, preserves other users, and requires fresh login after re-enabling', async () => {
      const logins = await Promise.all([
        auth.login({ email: author.email, password }),
        auth.login({ email: author.email, password }),
      ]);
      const adminLogin = await auth.login({ email: admin.email, password });
      await auth.forgotPassword({ email: author.email });
      const code = mail.sendCode.mock.calls[0][1];
      await service.updateStatus(author.id, { status: UserStatus.DISABLED });
      await expect(
        auth.login({ email: author.email, password }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      for (const login of logins) {
        await expect(
          auth.authenticate(login.accessToken),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(auth.refresh(login.refreshToken)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
      mail.sendCode.mockClear();
      const disabledResponse = await auth.forgotPassword({
        email: author.email,
      });
      expect(disabledResponse).toEqual(
        await auth.forgotPassword({ email: 'unknown@example.com' }),
      );
      expect(mail.sendCode).not.toHaveBeenCalled();
      await expect(
        auth.resetPassword({
          email: author.email,
          code,
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await auth.authenticate(adminLogin.accessToken)).id).toBe(
        admin.id,
      );
      await service.updateStatus(author.id, { status: UserStatus.ACTIVE });
      for (const login of logins)
        await expect(
          auth.authenticate(login.accessToken),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        auth.resetPassword({
          email: author.email,
          code,
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        await auth.login({ email: author.email, password }),
      ).toHaveProperty('accessToken');
    });

    it('prevents status changes to admins and handles missing users', async () => {
      for (const status of [UserStatus.DISABLED, UserStatus.ACTIVE]) {
        await expect(
          service.updateStatus(admin.id, { status }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect((await service.findOne(admin.id)).status).toBe(UserStatus.ACTIVE);
      await expect(service.findOne(randomUUID())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.updateStatus(randomUUID(), { status: UserStatus.DISABLED }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('serializes login and disable so no newly created session remains usable', async () => {
      const [login] = await Promise.allSettled([
        auth.login({ email: author.email, password }),
        service.updateStatus(author.id, { status: UserStatus.DISABLED }),
      ]);
      if (login.status === 'fulfilled') {
        await expect(
          auth.authenticate(login.value.accessToken),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(
          auth.refresh(login.value.refreshToken),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      } else expect(login.reason).toBeInstanceOf(UnauthorizedException);
      expect(
        await ds
          .getRepository(RefreshSessionEntity)
          .count({ where: { userId: author.id, revokedAt: IsNull() } }),
      ).toBe(0);
    });
  },
);
