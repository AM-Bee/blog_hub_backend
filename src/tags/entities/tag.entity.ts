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
import { CategoryEntity } from '../../categories/entities/category.entity.js';
import { UserEntity } from '../../users/entities/user.entity.js';

@Entity('tags')
@Index('UQ_tags_category_normalized_name', ['categoryId', 'normalizedName'], {
  unique: true,
})
@Index('UQ_tags_slug', ['slug'], { unique: true })
export class TagEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({
    name: 'normalized_name',
    type: 'varchar',
    length: 200,
    select: false,
  })
  normalizedName: string;

  @Column({ type: 'varchar', length: 240 })
  slug: string;

  @Index('IDX_tags_category_id')
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => CategoryEntity, (category) => category.tags, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'FK_tags_category',
  })
  category: Relation<CategoryEntity>;

  @Index()
  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
