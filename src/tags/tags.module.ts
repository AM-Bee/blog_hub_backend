import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from './entities/tag.entity.js';
import { TagsController } from './tags.controller.js';
import { TagsService } from './tags.service.js';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([TagEntity, CategoryEntity])],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
