import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity.js';
import { BlogEntity } from '../../blogs/entities/blog.entity.js';
import { BlogCommentEntity } from '../../comments/entities/blog-comment.entity.js';
import { ReactionType } from '../enums/reaction-type.enum.js';

@Entity('reactions')
@Check(
  'CK_reactions_target',
  '(blog_id IS NOT NULL AND comment_id IS NULL) OR (blog_id IS NULL AND comment_id IS NOT NULL)',
)
@Check('CK_reactions_type', "type IN ('like', 'dislike')")
@Index('UQ_reactions_blog_user', ['blogId', 'userId'], { unique: true })
@Index('UQ_reactions_comment_user', ['commentId', 'userId'], { unique: true })
export class ReactionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index('IDX_reactions_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_reactions_user',
  })
  user: Relation<UserEntity>;

  @Column({ name: 'blog_id', type: 'uuid', nullable: true }) blogId:
    string | null;
  @ManyToOne(() => BlogEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blog_id',
    foreignKeyConstraintName: 'FK_reactions_blog',
  })
  blog: Relation<BlogEntity> | null;

  @Column({ name: 'comment_id', type: 'uuid', nullable: true }) commentId:
    string | null;
  @ManyToOne(() => BlogCommentEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'comment_id',
    foreignKeyConstraintName: 'FK_reactions_comment',
  })
  comment: Relation<BlogCommentEntity> | null;

  @Column({ type: 'varchar', length: 7 }) type: ReactionType;
}
