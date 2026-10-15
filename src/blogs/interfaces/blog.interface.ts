import type { BlogStatus } from '../enums/blog-status.enum.js';

export interface BlogAuthor {
  id: string;
  displayName: string;
}

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
}

export interface BlogTag extends BlogCategory {
  categoryId: string;
}

export interface BlogBase {
  id: string;
  title: string;
  slug: string;
  author: BlogAuthor;
  categoryId: string | null;
  category: BlogCategory | null;
  categoryName: string;
  tags: BlogTag[];
  coverImageUrl: string | null;
  status: BlogStatus;
  publicationBlocked: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Blog extends BlogBase {
  content: string;
}

export interface BlogSummary extends BlogBase {
  excerpt: string;
}

export interface BlogPage {
  items: BlogSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
