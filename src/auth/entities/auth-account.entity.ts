import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity.js';

@Entity('auth_accounts')
@Index(
  'UQ_auth_accounts_provider_identity',
  ['provider', 'providerAccountId'],
  {
    unique: true,
  },
)
@Index('UQ_auth_accounts_user_provider', ['userId', 'provider'], {
  unique: true,
})
export class AuthAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_auth_accounts_user',
  })
  user: UserEntity;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ name: 'provider_account_id', type: 'varchar', length: 255 })
  providerAccountId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
