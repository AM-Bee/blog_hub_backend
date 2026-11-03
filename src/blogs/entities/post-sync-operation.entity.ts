import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity.js';
import type { Blog } from '../interfaces/blog.interface.js';

export type PostSyncResult = { blog: Blog } | { deleted: true; id: string };

@Entity('post_sync_operations')
export class PostSyncOperationEntity {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_post_sync_operations',
  })
  userId: string;
  @PrimaryColumn({
    name: 'operation_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_post_sync_operations',
  })
  operationId: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_post_sync_operations_user',
  })
  user: Relation<UserEntity>;
  @Column({ name: 'request_hash', type: 'text' }) requestHash: string;
  @Column({ type: 'jsonb' }) result: PostSyncResult;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
