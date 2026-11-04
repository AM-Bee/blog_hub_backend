import type { User } from '../users/interfaces/user.interface.js';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto.js';
import { Inject, Injectable } from '@nestjs/common';
import { AdminUsersRepository } from './admin-users.repository.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';
import { UpdateUserRoleDto } from './dto/update-user-role.dto.js';

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(AdminUsersRepository)
    private readonly repository: AdminUsersRepository,
  ) {}

  updatePermissions(id: string, dto: UpdateUserPermissionsDto, actor: User) {
    return this.repository.updatePermissions(id, dto, actor);
  }

  findAll(query: ListUsersQueryDto) {
    return this.repository.findAll(query);
  }

  findOne(id: string) {
    return this.repository.findOne(id);
  }

  updateStatus(id: string, dto: UpdateUserStatusDto, actor: User) {
    return this.repository.updateStatus(id, dto, actor);
  }

  updateRole(id: string, dto: UpdateUserRoleDto, actor: User) {
    return this.repository.updateRole(id, dto, actor);
  }
}
