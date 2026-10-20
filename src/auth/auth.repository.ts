import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity.js';
import { RefreshSessionEntity } from './entities/refresh-session.entity.js';
import { RefreshTokenEntity } from './entities/refresh-token.entity.js';
import { AuthAccountEntity } from './entities/auth-account.entity.js';

@Injectable()
export class AuthRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RefreshSessionEntity)
    private readonly sessions: Repository<RefreshSessionEntity>,
  ) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  findSession(id: string, userId: string) {
    return this.sessions.findOneBy({ id, userId });
  }

  findGoogleAccount(manager: EntityManager, providerAccountId: string) {
    return manager.findOneBy(AuthAccountEntity, {
      provider: 'google',
      providerAccountId,
    });
  }

  findLockedSession(manager: EntityManager, id: string) {
    return manager.findOne(RefreshSessionEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findUser(manager: EntityManager, id: string) {
    return manager.findOneBy(UserEntity, { id });
  }

  findLockedUserByEmail(manager: EntityManager, email: string) {
    return manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .setLock('pessimistic_write')
      .getOne();
  }

  findLockedUserById(manager: EntityManager, id: string) {
    return manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  findLockedResetUser(manager: EntityManager, email: string) {
    return manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .addSelect([
        'user.passwordResetCodeHash',
        'user.passwordResetExpiresAt',
        'user.passwordResetAttempts',
      ])
      .where('user.email = :email', { email })
      .setLock('pessimistic_write')
      .getOne();
  }

  findToken(manager: EntityManager, sessionId: string, tokenHash: string) {
    return manager.findOneBy(RefreshTokenEntity, { sessionId, tokenHash });
  }
}
