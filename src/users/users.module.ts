import { UsersRepository } from './users.repository.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service.js';
import { UserEntity } from './entities/user.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [UsersRepository, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
