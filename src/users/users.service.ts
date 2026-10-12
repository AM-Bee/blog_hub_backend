import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import type { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { validateDto } from '../common/validation.utils.js';
import { UserEntity, UserRole } from './entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async create(createUserDto: CreateUserDto) {
    // Also validate internal callers, including the future Auth service.
    const dto = plainToInstance(CreateUserDto, createUserDto);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) {
      throw new BadRequestException(
        errors.flatMap((error) => Object.values(error.constraints ?? {})),
      );
    }

    const existing = await this.userRepository.findOneBy({ email: dto.email });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      displayName: dto.displayName,
      email: dto.email,
      passwordHash,
      role: UserRole.AUTHOR,
    });

    try {
      await this.userRepository.save(user);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const databaseError = error.driverError as {
          code?: string;
          constraint?: string;
        };
        if (
          databaseError.code === '23505' &&
          databaseError.constraint === 'UQ_users_email'
        ) {
          throw new ConflictException('Email already in use');
        }
      }
      throw error;
    }
    return { message: 'User Registered Successfully' };
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateProfile(id: string, input: UpdateUserDto) {
    const dto = await validateDto(input, UpdateUserDto);
    if (dto.displayName === undefined && dto.email === undefined)
      throw new BadRequestException('Provide displayName or email');
    try {
      await this.userRepository.manager.transaction(async (manager) => {
        const user = await manager
          .getRepository(UserEntity)
          .createQueryBuilder('user')
          .addSelect('user.passwordHash')
          .where('user.id = :id', { id })
          .setLock('pessimistic_write')
          .getOne();
        if (!user) throw new NotFoundException('User not found');
        if (dto.email !== undefined && dto.email !== user.email) {
          if (
            !dto.currentPassword ||
            Buffer.byteLength(dto.currentPassword, 'utf8') > 72 ||
            !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
          )
            throw new UnauthorizedException('Current password is incorrect');
          user.email = dto.email;
          // Codes sent to the previous address must no longer work.
          user.passwordResetCodeHash = null;
          user.passwordResetExpiresAt = null;
          user.passwordResetAttempts = 0;
        }
        if (dto.displayName !== undefined) user.displayName = dto.displayName;
        await manager.save(UserEntity, user);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string; constraint?: string }).code ===
          '23505' &&
        (error.driverError as { constraint?: string }).constraint ===
          'UQ_users_email'
      )
        throw new ConflictException('Email already in use');
      throw error;
    }
    return this.findOne(id);
  }

  // Internal login lookup only. Never return this entity from a controller.
  async findOneByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }
}
