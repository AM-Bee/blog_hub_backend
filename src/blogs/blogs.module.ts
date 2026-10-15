import { BlogsRepository } from './blogs.repository.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogTagEntity } from './entities/blog-tag.entity.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { BlogImageStore } from './blog-image.store.js';
import { BlogsService } from './blogs.service.js';
import { BlogsController } from './blogs.controller.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      BlogEntity,
      BlogTagEntity,
      CategoryEntity,
      TagEntity,
    ]),
  ],
  controllers: [BlogsController],
  providers: [BlogsRepository, BlogsService, BlogImageStore],
  exports: [BlogsService],
})
export class BlogsModule {}
