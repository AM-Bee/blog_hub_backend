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
import { TagEntity } from '../../tags/entities/tag.entity.js';
import { UserEntity } from '../../users/entities/user.entity.js';

@Entity('categories')
@Index('UQ_categories_normalized_name', ['normalizedName'], { unique: true })
@Index('UQ_categories_slug', ['slug'], { unique: true })
export class CategoryEntity {
  @OneToMany(() => TagEntity, (tag) => tag.category)
  tags: Relation<TagEntity[]>;

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
