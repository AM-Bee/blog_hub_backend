import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import type { Repository } from 'typeorm';
import {
  UserEntity,
  UserRole,
  UserStatus,
} from '../users/entities/user.entity.js';
import { RefreshSessionEntity } from '../auth/entities/refresh-session.entity.js';
import { BlogEntity } from '../blogs/entities/blog.entity.js';
import { validateDto } from '../common/validation.utils.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async findAll(input: ListUsersQueryDto) {
    const dto = await validateDto(input, ListUsersQueryDto);
    const query = this.userRepository.createQueryBuilder('user');
    if (dto.q) {
      const q = `%${dto.q.replace(/[\\%_]/g, '\\$&')}%`;
      query.andWhere('(user.displayName ILIKE :q OR user.email ILIKE :q)', {
        q,
      });
    }
    if (dto.role) query.andWhere('user.role = :role', { role: dto.role });
    if (dto.status)
      query.andWhere('user.status = :status', { status: dto.status });
    const [users, total] = await query
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .skip((dto.page - 1) * dto.limit)
      .take(dto.limit)
      .getManyAndCount();
    return {
      items: users.map((user) => this.profile(user)),
      page: dto.page,
      limit: dto.limit,
      total,
      totalPages: Math.ceil(total / dto.limit),
    };
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    const blogCount = await this.userRepository.manager.count(BlogEntity, {
      where: { authorId: id },
    });
    return { ...this.profile(user), blogCount };
  }

  async updateStatus(id: string, input: UpdateUserStatusDto) {
    const dto = await validateDto(input, UpdateUserStatusDto);
    await this.userRepository.manager.transaction(async (manager) => {
      // Use the same user lock as login and password reset to serialize account changes.
      const user = await manager.findOne(UserEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');
      if (user.role !== UserRole.AUTHOR)
        throw new ForbiddenException(
          'Only author accounts can be enabled or disabled',
        );
      await manager.update(UserEntity, { id }, { status: dto.status });
      if (dto.status === UserStatus.DISABLED) {
        await manager.update(
          UserEntity,
          { id },
          {
            passwordResetCodeHash: null,
            passwordResetExpiresAt: null,
            passwordResetAttempts: 0,
          },
        );
        await manager.update(
          RefreshSessionEntity,
          { userId: id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      }
    });
    return this.findOne(id);
  }

  private profile(user: UserEntity) {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
