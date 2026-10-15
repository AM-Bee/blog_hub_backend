import { UserRole } from '../enums/user-role.enum.js';
import { UserStatus } from '../enums/user-status.enum.js';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
@Index('UQ_users_email', ['email'], { unique: true })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName: string;

  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 60, select: false })
  passwordHash: string;

  @Column({
    name: 'password_reset_code_hash',
    type: 'varchar',
    length: 60,
    nullable: true,
    select: false,
  })
  passwordResetCodeHash: string | null;

  @Column({
    name: 'password_reset_expires_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  passwordResetExpiresAt: Date | null;

  @Column({
    name: 'password_reset_attempts',
    type: 'int',
    default: 0,
    select: false,
  })
  passwordResetAttempts: number;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.AUTHOR })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
