import {
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
import { CategoryEntity } from '../../categories/entities/category.entity.js';
import { BlogTagEntity } from './blog-tag.entity.js';

export enum BlogStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

@Entity('blogs')
@Index('UQ_blogs_slug', ['slug'], { unique: true })
@Index('IDX_blogs_published', ['status', 'publishedAt', 'id'])
export class BlogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'author_id',
    foreignKeyConstraintName: 'FK_blogs_author',
  })
  author: Relation<UserEntity>;

  @Index()
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => CategoryEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'FK_blogs_category',
  })
  category: Relation<CategoryEntity> | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  slug: string;

  @Column({ type: 'text' })
  content: string;

  @Column({
    name: 'cover_image_url',
    type: 'varchar',
    length: 2048,
    nullable: true,
  })
  coverImageUrl: string | null;

  @Column({ type: 'enum', enum: BlogStatus, default: BlogStatus.DRAFT })
  status: BlogStatus;

  @Column({ name: 'publication_blocked', type: 'boolean', default: false })
  publicationBlocked: boolean;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @OneToMany(() => BlogTagEntity, (link) => link.blog)
  tagLinks: Relation<BlogTagEntity[]>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
