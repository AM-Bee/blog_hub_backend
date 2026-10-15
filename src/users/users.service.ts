import { Inject, Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository) private readonly repository: UsersRepository,
  ) {}

  create(dto: CreateUserDto) {
    return this.repository.create(dto);
  }

  findOne(id: string) {
    return this.repository.findOne(id);
  }

  updateProfile(id: string, dto: UpdateUserDto) {
    return this.repository.updateProfile(id, dto);
  }
}
