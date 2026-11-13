import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { PushDeviceEntity } from './entities/push-device.entity.js';
import { PushJobEntity } from './entities/push-job.entity.js';
import { PushDevicesService } from './push-devices.service.js';
import { PushController } from './push.controller.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([PushDeviceEntity, PushJobEntity]),
  ],
  controllers: [PushController],
  providers: [PushDevicesService],
})
export class PushModule {}
