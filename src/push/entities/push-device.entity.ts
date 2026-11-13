import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity.js';
import { RefreshSessionEntity } from '../../auth/entities/refresh-session.entity.js';

@Entity('push_devices')
@Index('UQ_push_devices_device', ['deviceId'], { unique: true })
@Index('UQ_push_devices_token', ['expoPushToken'], { unique: true })
@Index('IDX_push_devices_user_session', ['userId', 'sessionId'])
export class PushDeviceEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'device_id', type: 'uuid' }) deviceId: string;
  @Column({ name: 'expo_push_token', type: 'varchar', length: 255 })
  expoPushToken: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_push_devices_user',
  })
  user: Relation<UserEntity>;
  @ManyToOne(() => RefreshSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'FK_push_devices_session',
  })
  session: Relation<RefreshSessionEntity>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
