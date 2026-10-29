import { ChatModule } from '../chat/chat.module.js';
import { ConversationEntity } from '../chat/entities/conversation.entity.js';
import { MessageEntity } from '../chat/entities/message.entity.js';
import { BlogsModule } from '../blogs/blogs.module.js';
import { AdminUsersModule } from '../admin-users/admin-users.module.js';
import { BlogEntity } from '../blogs/entities/blog.entity.js';
import { BlogTagEntity } from '../blogs/entities/blog-tag.entity.js';
import { BlogAuditLogEntity } from '../blogs/entities/blog-audit-log.entity.js';
import { NotificationEntity } from '../notifications/entities/notification.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import {
  Global,
  Module,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CategoriesModule } from '../categories/categories.module.js';
import { CategoriesController } from '../categories/categories.controller.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagsModule } from '../tags/tags.module.js';
import { TagsController } from '../tags/tags.controller.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity.js';
import { AuthAccountEntity } from '../auth/entities/auth-account.entity.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';

class MetadataDataSource extends DataSource {
  prepareMetadata() {
    return this.buildMetadatas();
  }
}
const dataSource = new MetadataDataSource({
  type: 'postgres',
  entities: [
    UserEntity,
    RefreshSessionEntity,
    RefreshTokenEntity,
    AuthAccountEntity,
    CategoryEntity,
    TagEntity,
    BlogEntity,
    BlogTagEntity,
    BlogAuditLogEntity,
    NotificationEntity,
    ConversationEntity,
    MessageEntity,
  ],
});
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: dataSource }],
  exports: [DataSource],
})
class TestDatabaseModule {}

describe.each([CategoriesController, TagsController])(
  '%s route authorization',
  (Controller) => {
    it('keeps reads public and protects every mutation with JWT and role checks', () => {
      const routes = Controller.prototype;
      expect(
        Reflect.getMetadata(GUARDS_METADATA, routes.findAll),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, routes.findOne),
      ).toBeUndefined();
      for (const action of [routes.create, routes.update, routes.remove]) {
        expect(Reflect.getMetadata(GUARDS_METADATA, action)).toEqual([
          JwtAuthGuard,
          RolesGuard,
        ]);
      }
      expect(Reflect.getMetadata(ROLES_KEY, routes.create)).toEqual([
        UserRole.AUTHOR,
        UserRole.ADMIN,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, routes.update)).toEqual([
        UserRole.AUTHOR,
        UserRole.ADMIN,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, routes.remove)).toEqual([
        UserRole.ADMIN,
      ]);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, routes.remove)).toBe(204);
    });

    it('rejects an author or unauthenticated user at the deletion role guard', () => {
      const guard = new RolesGuard(new Reflector());
      const ctx = (user?: object) =>
        ({
          getHandler: () => Controller.prototype.remove,
          getClass: () => Controller,
          switchToHttp: () => ({ getRequest: () => ({ user }) }),
        }) as unknown as ExecutionContext;
      expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(ctx({ role: UserRole.AUTHOR }))).toThrow(
        ForbiddenException,
      );
      expect(guard.canActivate(ctx({ role: UserRole.ADMIN }))).toBe(true);
    });
  },
);

describe('Taxonomy module and PostgreSQL metadata wiring', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('wires feature services and repositories, relations, and Swagger without a live database', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret-for-bloghub-at-least-32-bytes');
    await dataSource.prepareMetadata();
    for (const Entity of [CategoryEntity, TagEntity]) {
      const metadata = dataSource.getMetadata(Entity);
      expect(
        metadata.foreignKeys.some((key) => key.referencedTablePath === 'users'),
      ).toBe(true);
      expect(
        metadata.findColumnWithPropertyName('normalizedName')?.isSelect,
      ).toBe(false);
      expect(
        metadata.indices
          .filter((index) => index.isUnique)
          .map((index) =>
            index.columns.map((column) => column.propertyName).join(','),
          )
          .sort(),
      ).toEqual(
        Entity === TagEntity
          ? ['categoryId,normalizedName', 'slug']
          : ['normalizedName', 'slug'],
      );
    }
    const tagMetadata = dataSource.getMetadata(TagEntity);
    expect(
      tagMetadata.foreignKeys.find((key) => key.name === 'FK_tags_category')
        ?.onDelete,
    ).toBe('CASCADE');
    expect(
      tagMetadata.findColumnWithPropertyName('categoryId')?.isNullable,
    ).toBe(false);
    const module = await Test.createTestingModule({
      imports: [
        TestDatabaseModule,
        CategoriesModule,
        TagsModule,
        BlogsModule,
        AdminUsersModule,
        NotificationsModule,
        ChatModule,
      ],
    }).compile();
    const app = module.createNestApplication();
    try {
      app.setGlobalPrefix('api/v1');
      await app.init();
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('BlogHub')
          .setVersion('1.0')
          .addBearerAuth()
          .build(),
      );
      for (const resource of ['categories', 'tags']) {
        expect(
          document.paths[`/api/v1/${resource}`].get?.security,
        ).toBeUndefined();
        expect(document.paths[`/api/v1/${resource}`].post?.security).toEqual([
          { bearer: [] },
        ]);
        expect(
          Object.keys(document.paths[`/api/v1/${resource}/{id}`]).sort(),
        ).toEqual(['delete', 'patch']);
        expect(document.paths[`/api/v1/${resource}/{slug}`].get).toBeDefined();
      }
      expect(
        Object.keys(document.paths).some((path) => path.includes('/blogs')),
      ).toBe(true);
      expect(document.paths['/api/v1/auth/me'].get?.security).toEqual([
        { bearer: [] },
      ]);
      expect(document.paths['/api/v1/admin/users'].get?.security).toEqual([
        { bearer: [] },
      ]);
      expect(document.paths['/api/v1/admin/users/{id}'].patch?.security).toEqual([
        { bearer: [] },
      ]);
      expect(document.paths['/api/v1/me/notifications'].get?.security).toEqual([
        { bearer: [] },
      ]);
      expect(
        document.paths['/api/v1/me/notifications/read-all'].patch,
      ).toBeDefined();
      expect(
        document.paths['/api/v1/me/notifications/{id}/read'].patch,
      ).toBeDefined();
      for (const method of ['get', 'post'] as const) {
        expect(
          document.paths['/api/v1/chat/conversations'][method]?.security,
        ).toEqual([{ bearer: [] }]);
      }
      expect(
        document.paths['/api/v1/chat/conversations/{id}/messages'].get
          ?.security,
      ).toEqual([{ bearer: [] }]);
      expect(document.components?.schemas?.UserResponseDto).toMatchObject({
        properties: { role: { enum: ['author', 'admin'] } },
      });
    } finally {
      await app.close();
    }
  });
});
