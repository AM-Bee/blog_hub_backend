import {
  BeforeInsert,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity.js';
import { MessageEntity } from './message.entity.js';

// The migration also installs database triggers; synchronization cannot create those.
@Entity({ name: 'chat_conversations', synchronize: false })
@Check('CK_chat_conversations_order', '"user1_id" < "user2_id"')
@Index('UQ_chat_conversations_pair', ['user1Id', 'user2Id'], { unique: true })
@Index('IDX_chat_conversations_user1_updated', ['user1Id', 'updatedAt', 'id'])
@Index('IDX_chat_conversations_user2_updated', ['user2Id', 'updatedAt', 'id'])
export class ConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user1_id', type: 'uuid' })
  user1Id: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user1_id',
    foreignKeyConstraintName: 'FK_chat_conversations_user1',
  })
  user1: Relation<UserEntity>;

  @Column({ name: 'user2_id', type: 'uuid' })
  user2Id: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user2_id',
    foreignKeyConstraintName: 'FK_chat_conversations_user2',
  })
  user2: Relation<UserEntity>;

  @OneToMany(() => MessageEntity, (message) => message.conversation)
  messages: Relation<MessageEntity[]>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Lowercase and sort participants before entity insertion so either user order represents the same pair. */
  @BeforeInsert()
  normalizeParticipants(): void {
    // UUIDs have a consistent lowercase representation, so either input order gives the same pair.
    const participants = [
      this.user1Id.toLowerCase(),
      this.user2Id.toLowerCase(),
    ].sort();
    [this.user1Id, this.user2Id] = participants;
  }
}
