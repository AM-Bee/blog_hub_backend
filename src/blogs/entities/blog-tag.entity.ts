import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { BlogEntity } from './blog.entity.js';
import { TagEntity } from '../../tags/entities/tag.entity.js';

@Entity('blog_tags')
@Index('IDX_blog_tags_tag_id', ['tagId'])
export class BlogTagEntity {
  @PrimaryColumn({ name: 'blog_id', type: 'uuid' })
  blogId: string;

  @PrimaryColumn({ name: 'tag_id', type: 'uuid' })
  tagId: string;

  @ManyToOne(() => BlogEntity, (blog) => blog.tagLinks, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blog_id',
    foreignKeyConstraintName: 'FK_blog_tags_blog',
  })
  blog: Relation<BlogEntity>;

  @ManyToOne(() => TagEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id', foreignKeyConstraintName: 'FK_blog_tags_tag' })
  tag: Relation<TagEntity>;
}
