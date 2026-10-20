import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BlogAuditAction } from '../enums/blog-audit-action.enum.js';
import type {
  BlogAuditChanges,
  BlogAuditSnapshot,
} from '../interfaces/blog-audit-log.interface.js';

@Entity('blog_audit_logs')
@Index('IDX_blog_audit_logs_actor_created', ['actorId', 'createdAt', 'id'])
@Index('IDX_blog_audit_logs_blog', ['blogId'])
export class BlogAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Historical IDs deliberately have no cascading foreign keys.
  @Column({ name: 'blog_id', type: 'uuid' })
  blogId: string;

  @Column({ name: 'blog_title', type: 'varchar', length: 200 })
  blogTitle: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ name: 'post_author_id', type: 'uuid' })
  postAuthorId: string;

  @Column({ type: 'varchar', length: 20 })
  action: BlogAuditAction;

  @Column({ type: 'jsonb', select: false })
  changes: BlogAuditChanges;

  @Column({ type: 'jsonb', nullable: true, select: false })
  snapshot: BlogAuditSnapshot | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
