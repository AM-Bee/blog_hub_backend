import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module.js';
import { FaqEntity } from './entities/faq.entity.js';
import { FaqCategoryEntity } from './entities/faq-category.entity.js';
import { FaqController } from './faq.controller.js';
import { AdminFaqController } from './admin-faq.controller.js';
import { FaqService } from './faq.service.js';
import { FaqRepository } from './faq.repository.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([FaqEntity, FaqCategoryEntity]),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
  ],
  controllers: [FaqController, AdminFaqController],
  providers: [FaqService, FaqRepository, ThrottlerGuard],
})
export class FaqModule {}
