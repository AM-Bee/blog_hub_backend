import {
  Check,
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
import { ConversationEntity } from './conversation.entity.js';

@Entity({ name: 'chat_messages', synchronize: false })
@Check(
  'CK_chat_messages_content',
  `
  ("deleted_at" IS NULL AND "content" IS NOT NULL AND "content" ~ '[^[:space:]]')
  OR ("deleted_at" IS NOT NULL AND "content" IS NULL)
`,
)
@Index('UQ_chat_messages_sender_client', ['senderId', 'clientMessageId'], {
  unique: true,
})
@Index('IDX_chat_messages_history', ['conversationId', 'createdAt', 'id'])
@Index('IDX_chat_messages_unread', ['conversationId', 'isRead', 'senderId'])
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(
    () => ConversationEntity,
    (conversation) => conversation.messages,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'FK_chat_messages_conversation',
  })
  conversation: Relation<ConversationEntity>;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'sender_id',
    foreignKeyConstraintName: 'FK_chat_messages_sender',
  })
  sender: Relation<UserEntity>;

  @Column({ name: 'client_message_id', type: 'uuid' })
  clientMessageId: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  content: string | null;

  // A normal column keeps the deleted placeholder visible in message history.
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
