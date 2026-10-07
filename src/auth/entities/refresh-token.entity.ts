import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { RefreshSessionEntity } from './refresh-session.entity.js';

// Retain used hashes until the session is deleted so replay can be detected.
@Entity('refresh_tokens')
export class RefreshTokenEntity {
  @PrimaryColumn({
    name: 'token_hash',
    type: 'varchar',
    length: 64,
    select: false,
  })
  tokenHash: string;

  @Index()
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => RefreshSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: RefreshSessionEntity;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
