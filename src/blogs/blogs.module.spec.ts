import { Global, Module, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { BlogsModule } from './blogs.module.js';
import { BlogsController } from './blogs.controller.js';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogTagEntity } from './entities/blog-tag.entity.js';
import { UserEntity, UserRole } from '../users/entities/user.entity.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { ExecutionContext } from '@nestjs/common';

class MetadataDataSource extends DataSource {
  prepare() {
    return this.buildMetadatas();
  }
}
const ds = new MetadataDataSource({
  type: 'postgres',
  entities: [
    UserEntity,
    CategoryEntity,
    TagEntity,
    RefreshSessionEntity,
    RefreshTokenEntity,
    BlogEntity,
    BlogTagEntity,
  ],
});
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: ds }],
  exports: [DataSource],
})
class TestDatabaseModule {}

describe('Blog module wiring and permissions', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('keeps public reads public and protects mutation, author and admin views', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, BlogsController.prototype.findAll),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, BlogsController.prototype.findOne),
    ).toBeUndefined();
    for (const handler of [
      'create',
      'update',
      'remove',
      'findMine',
      'findMyOne',
      'findAllForAdmin',
      'findOneForAdmin',
    ] as const) {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          BlogsController.prototype[handler],
        ),
      ).toEqual([JwtAuthGuard, RolesGuard]);
    }
    const guard = new RolesGuard(new Reflector());
    const ctx = {
      getClass: () => BlogsController,
      getHandler: () => BlogsController.prototype.findAllForAdmin,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: UserRole.AUTHOR } }),
      }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('uses SET NULL for categories and CASCADE only for tag associations', async () => {
    await ds.prepare();
    expect(
      ds
        .getMetadata(BlogEntity)
        .foreignKeys.find((key) => key.name === 'FK_blogs_category')?.onDelete,
    ).toBe('SET NULL');
    expect(
      ds.getMetadata(BlogEntity).findColumnWithPropertyName('categoryId')
        ?.isNullable,
    ).toBe(true);
    expect(
      ds.getMetadata(BlogTagEntity).foreignKeys.map((key) => key.onDelete),
    ).toEqual(['CASCADE', 'CASCADE']);
  });

  it('initializes the module and documents its routes without accessing PostgreSQL', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret-for-bloghub-at-least-32-bytes');
    await ds.prepare();
    const module = await Test.createTestingModule({
      imports: [TestDatabaseModule, BlogsModule],
    }).compile();
    const app = module.createNestApplication();
    try {
      app.setGlobalPrefix('api/v1');
      await app.init();
      const docs = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('BlogHub')
          .setVersion('1.0')
          .addBearerAuth()
          .build(),
      );
      expect(docs.paths['/api/v1/blogs'].get?.security).toBeUndefined();
      expect(
        docs.paths['/api/v1/blogs'].get?.parameters?.map((parameter) =>
          'name' in parameter ? parameter.name : '',
        ),
      ).toEqual(
        expect.arrayContaining([
          'q',
          'category',
          'tag',
          'author',
          'page',
          'limit',
        ]),
      );
      expect(docs.paths['/api/v1/blogs'].post?.security).toEqual([
        { bearer: [] },
      ]);
      expect(docs.paths['/api/v1/me/blogs/{id}'].get).toBeDefined();
      expect(docs.paths['/api/v1/admin/blogs/{id}'].get).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
