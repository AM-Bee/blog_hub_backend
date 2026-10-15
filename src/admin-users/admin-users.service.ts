import { Inject, Injectable } from '@nestjs/common';
import { AdminUsersRepository } from './admin-users.repository.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(AdminUsersRepository)
    private readonly repository: AdminUsersRepository,
  ) {}

  findAll(query: ListUsersQueryDto) {
    return this.repository.findAll(query);
  }

  findOne(id: string) {
    return this.repository.findOne(id);
  }

  updateStatus(id: string, dto: UpdateUserStatusDto) {
    return this.repository.updateStatus(id, dto);
  }
}
