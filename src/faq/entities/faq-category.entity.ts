import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { FaqEntity } from './faq.entity.js';

@Entity('faq_categories')
@Index('UQ_faq_categories_name', ['name'], { unique: true })
@Index('UQ_faq_categories_slug', ['slug'], { unique: true })
export class FaqCategoryEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 150 }) slug: string;
  @OneToMany(() => FaqEntity, (faq) => faq.category) faqs: Relation<
    FaqEntity[]
  >;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
