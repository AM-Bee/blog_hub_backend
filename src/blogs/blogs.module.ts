import { BlogsRepository } from './blogs.repository.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogTagEntity } from './entities/blog-tag.entity.js';
import { BlogAuditLogEntity } from './entities/blog-audit-log.entity.js';
import { NotificationEntity } from '../notifications/entities/notification.entity.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { BlogImageStore } from './blog-image.store.js';
import { BlogsService } from './blogs.service.js';
import { BlogsController } from './blogs.controller.js';
import { PostSyncOperationEntity } from './entities/post-sync-operation.entity.js';
import { PostSyncController } from './post-sync.controller.js';
import { PostSyncService } from './post-sync.service.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      BlogEntity,
      PostSyncOperationEntity,
      BlogTagEntity,
      BlogAuditLogEntity,
      NotificationEntity,
      CategoryEntity,
      TagEntity,
    ]),
  ],
  controllers: [BlogsController, PostSyncController],
  providers: [BlogsRepository, BlogsService, BlogImageStore, PostSyncService],
  exports: [BlogsService],
})
export class BlogsModule {}
