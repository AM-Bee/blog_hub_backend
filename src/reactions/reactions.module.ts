import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { ReactionEntity } from './entities/reaction.entity.js';
import { ReactionsController } from './reactions.controller.js';
import { ReactionsService } from './reactions.service.js';
import { ReactionsRepository } from './reactions.repository.js';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([ReactionEntity])],
  controllers: [ReactionsController],
  providers: [ReactionsService, ReactionsRepository, OptionalJwtAuthGuard],
  exports: [ReactionsRepository],
})
export class ReactionsModule {}
