import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { BlogEntity } from '../../blogs/entities/blog.entity.js';
import { UserEntity } from '../../users/entities/user.entity.js';

@Entity('blog_comments')
@Index('IDX_blog_comments_thread', ['blogId', 'parentId', 'createdAt', 'id'])
export class BlogCommentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'blog_id', type: 'uuid' }) blogId: string;
  @ManyToOne(() => BlogEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blog_id',
    foreignKeyConstraintName: 'FK_blog_comments_blog',
  })
  blog: Relation<BlogEntity>;

  @Index('IDX_blog_comments_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_blog_comments_user',
  })
  author: Relation<UserEntity>;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) parentId:
    string | null;
  @ManyToOne(() => BlogCommentEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'parent_id',
    foreignKeyConstraintName: 'FK_blog_comments_parent',
  })
  parent: Relation<BlogCommentEntity> | null;

  @Column({ type: 'text' }) content: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
