import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReactionsModule } from '../reactions/reactions.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BlogCommentEntity } from './entities/blog-comment.entity.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';
import { CommentsRepository } from './comments.repository.js';

@Module({
  imports: [
    AuthModule,
    ReactionsModule,
    TypeOrmModule.forFeature([BlogCommentEntity]),
  ],
  controllers: [CommentsController],
  providers: [CommentsService, CommentsRepository],
})
export class CommentsModule {}
