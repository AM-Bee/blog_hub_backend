import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ContactController } from './contact.controller.js';
import { ContactService } from './contact.service.js';
import { RecaptchaService } from './recaptcha.service.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
  controllers: [ContactController],
  providers: [ContactService, RecaptchaService, ThrottlerGuard],
})
export class ContactModule {}
