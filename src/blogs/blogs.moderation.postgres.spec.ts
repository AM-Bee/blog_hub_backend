import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UsersService } from '../users/users.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { PasswordResetMailService } from '../auth/password-reset-mail.service.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogStatus } from './enums/blog-status.enum.js';
import { BlogTagEntity } from './entities/blog-tag.entity.js';
import { BlogsService } from './blogs.service.js';
import { BlogsRepository } from './blogs.repository.js';
import { BlogsController } from './blogs.controller.js';

// No application tables are changed and email delivery is mocked.
describe.skipIf(process.env.BLOGHUB_RUN_DB_TESTS !== '1')(
  'Blog moderation against PostgreSQL',
  () => {
    const schema = `bloghub_moderation_test_${randomUUID().replaceAll('-', '')}`;
    let client: pg.Client;
    let ds: DataSource;
    let app: INestApplication;
    let createdSchema = false;
    let service: BlogsService;
    let auth: AuthService;
    let blog: BlogEntity;
    let owner: Awaited<ReturnType<UsersService['findOne']>>;
    let admin: typeof owner;
    let ownerToken: string;
    let adminToken: string;

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
        new JwtService({ secret: 'moderation-test-secret-at-least-32-bytes' }),
        new AuthRepository(ds, ds.getRepository(RefreshSessionEntity)),
        {
          ensureConfigured: vi.fn(),
          sendCode: vi.fn(),
        } as unknown as PasswordResetMailService,
      );
      service = new BlogsService(
        new BlogsRepository(ds.getRepository(BlogEntity), ds),
      );
      const module = await Test.createTestingModule({
        controllers: [BlogsController],
        providers: [
          { provide: BlogsService, useValue: service },
          { provide: AuthService, useValue: auth },
          JwtAuthGuard,
          RolesGuard,
        ],
      }).compile();
      app = module.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.listen(0, '127.0.0.1');
      const password = 'TestPassword123!';
      for (const role of [UserRole.AUTHOR, UserRole.ADMIN]) {
        const user = await ds.getRepository(UserEntity).save({
          email: `${role}@example.com`,
          displayName: role,
          role,
          passwordHash: await bcrypt.hash(password, 4),
        });
        const profile = await users.findOne(user.id);
        const { accessToken } = await auth.login({
          email: user.email,
          password,
        });
        if (role === UserRole.AUTHOR) {
          owner = profile;
          ownerToken = accessToken;
        } else {
          admin = profile;
          adminToken = accessToken;
        }
      }
    }, 30_000);

    beforeEach(async () => {
      await ds.query(`TRUNCATE TABLE "${schema}".blogs CASCADE`);
      blog = await ds.getRepository(BlogEntity).save({
        authorId: owner.id,
        title: 'Original',
        content: 'Original content',
        slug: 'original',
        status: BlogStatus.PUBLISHED,
        publishedAt: new Date('2026-01-01T00:00:00Z'),
      });
    });

    afterAll(async () => {
      await app?.close();
      if (ds?.isInitialized) await ds.destroy();
      if (createdSchema) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client?.end();
    }, 30_000);

    const moderate = (id: string, body: object, token = adminToken) =>
      request(app.getHttpServer())
        .patch(`/api/v1/admin/blogs/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('requires admin authentication, validates UUID/status, and rejects content changes', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/blogs/${blog.id}/status`)
        .send({ status: 'draft' })
        .expect(401);
      await moderate(blog.id, { status: 'draft' }, ownerToken).expect(403);
      await moderate('invalid', { status: 'draft' }).expect(400);
      await moderate(randomUUID(), { status: 'draft' }).expect(404);
      for (const body of [
        {},
        { status: null },
        { status: 'hidden' },
        { status: 'draft', title: 'Admin edit' },
        { status: 'draft', publicationBlocked: false },
      ])
        await moderate(blog.id, body).expect(400);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Admin edit' })
        .expect(403);
      expect((await service.findOne(blog.slug)).title).toBe('Original');
    });

    it('hides an admin-unpublished post, allows owner edits, and only admin publishing clears the block', async () => {
      const hidden = await moderate(blog.id, { status: 'draft' }).expect(200);
      expect(hidden.body).toMatchObject({
        publicationBlocked: true,
        status: 'draft',
        title: 'Original',
        publishedAt: blog.publishedAt!.toISOString(),
      });
      await request(app.getHttpServer())
        .get(`/api/v1/blogs/${blog.slug}`)
        .expect(404);
      expect((await service.findAll({ page: 1, limit: 10 })).total).toBe(0);
      expect((await service.findMyOne(blog.id, owner)).publicationBlocked).toBe(
        true,
      );
      const edit = await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Fixed', status: 'draft' })
        .expect(200);
      expect(edit.body.publicationBlocked).toBe(true);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'published' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ publicationBlocked: false })
        .expect(400);
      const published = await moderate(blog.id, { status: 'published' }).expect(
        200,
      );
      expect(published.body).toMatchObject({
        publicationBlocked: false,
        title: 'Fixed',
        publishedAt: blog.publishedAt!.toISOString(),
      });
      await request(app.getHttpServer())
        .get(`/api/v1/blogs/${blog.slug}`)
        .expect(200);
      expect((await service.findAll({ page: 1, limit: 10 })).total).toBe(1);
      await service.update(blog.id, { status: BlogStatus.DRAFT }, owner);
      expect(
        (await service.update(blog.id, { status: BlogStatus.PUBLISHED }, owner))
          .status,
      ).toBe(BlogStatus.PUBLISHED);
    });

    it('allows ordinary draft publishing, sets first publication time, and can block an existing draft', async () => {
      await ds
        .getRepository(BlogEntity)
        .update(blog.id, { status: BlogStatus.DRAFT, publishedAt: null });
      const published = await moderate(blog.id, { status: 'published' }).expect(
        200,
      );
      expect(published.body.publishedAt).toBeTruthy();
      await service.update(blog.id, { status: BlogStatus.DRAFT }, owner);
      await moderate(blog.id, { status: 'draft' }).expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/blogs/${blog.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'published' })
        .expect(403);
      // Repeating an admin unpublish must keep the block.
      expect(
        (await moderate(blog.id, { status: 'draft' }).expect(200)).body
          .publicationBlocked,
      ).toBe(true);
    });

    it('serializes admin unpublishing against owner publishing', async () => {
      await Promise.allSettled([
        service.updateStatusForAdmin(
          blog.id,
          { status: BlogStatus.DRAFT },
          admin,
        ),
        service.update(blog.id, { status: BlogStatus.PUBLISHED }, owner),
      ]);
      expect(await service.findMyOne(blog.id, owner)).toMatchObject({
        status: BlogStatus.DRAFT,
        publicationBlocked: true,
      });
    });
  },
);
