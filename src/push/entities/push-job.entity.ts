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
import { PushDeviceEntity } from './push-device.entity.js';
import { MessageEntity } from '../../chat/entities/message.entity.js';

export type PushJobStatus =
  'pending' | 'receipt' | 'complete' | 'failed' | 'cancelled';

@Entity('push_jobs')
@Index('UQ_push_jobs_message_device', ['messageId', 'registrationId'], {
  unique: true,
})
@Index('IDX_push_jobs_due', ['status', 'nextAttemptAt', 'id'])
export class PushJobEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'message_id', type: 'uuid' }) messageId: string;
  @Column({ name: 'registration_id', type: 'uuid' }) registrationId: string;
  @ManyToOne(() => MessageEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'message_id',
    foreignKeyConstraintName: 'FK_push_jobs_message',
  })
  message: Relation<MessageEntity>;
  @ManyToOne(() => PushDeviceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'registration_id',
    foreignKeyConstraintName: 'FK_push_jobs_registration',
  })
  registration: Relation<PushDeviceEntity>;
  @Column({ name: 'sender_display_name', type: 'varchar', length: 100 })
  senderDisplayName: string;
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: PushJobStatus;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'receipt_checks', type: 'integer', default: 0 })
  receiptChecks: number;
  @Column({ name: 'ticket_id', type: 'varchar', length: 255, nullable: true })
  ticketId: string | null;
  @Column({ name: 'last_error', type: 'varchar', length: 80, nullable: true })
  lastError: string | null;
  @Column({
    name: 'next_attempt_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  nextAttemptAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
