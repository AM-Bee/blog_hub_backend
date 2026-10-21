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
import { NotificationType } from '../enums/notification-type.enum.js';

@Entity('notifications')
@Index('IDX_notifications_user_created', ['userId', 'createdAt', 'id'])
@Index('IDX_notifications_user_read', ['userId', 'readAt'])
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_notifications_user',
  })
  user: UserEntity;

  @Column({ type: 'varchar', length: 32 })
  type: NotificationType;

  // No blog foreign key: notifications must survive deletion of the post.
  @Column({ name: 'blog_id', type: 'uuid' })
  blogId: string;

  @Column({ name: 'blog_title', type: 'varchar', length: 200 })
  blogTitle: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
