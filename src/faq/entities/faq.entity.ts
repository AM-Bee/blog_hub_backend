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
import { FaqCategoryEntity } from './faq-category.entity.js';

@Entity('faqs')
@Index('IDX_faqs_category_active_order', [
  'categoryId',
  'isActive',
  'displayOrder',
  'id',
])
export class FaqEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'category_id', type: 'uuid' }) categoryId: string;
  @ManyToOne(() => FaqCategoryEntity, (category) => category.faqs, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'FK_faqs_category',
  })
  category: Relation<FaqCategoryEntity>;
  @Column({ type: 'varchar', length: 500 }) question: string;
  @Column({ type: 'text' }) answer: string;
  @Column({
    name: 'alternative_questions',
    type: 'text',
    array: true,
    default: [],
  })
  alternativeQuestions: string[];
  @Column({ type: 'text', array: true, default: [] })
  keywords: string[];
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
