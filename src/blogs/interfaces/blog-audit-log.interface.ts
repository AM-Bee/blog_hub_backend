import type { Blog } from './blog.interface.js';
import type { BlogAuditAction } from '../enums/blog-audit-action.enum.js';

// JSON snapshots use ISO strings, not JavaScript Date objects.
export interface BlogAuditSnapshot extends Omit<
  Blog,
  'author' | 'publishedAt' | 'createdAt' | 'updatedAt'
> {
  authorId: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BlogAuditField =
  | 'title'
  | 'content'
  | 'category'
  | 'tags'
  | 'coverImageUrl'
  | 'status'
  | 'publicationBlocked'
  | 'publishedAt';

export type BlogAuditChanges = Partial<
  Record<
    BlogAuditField,
    {
      old: BlogAuditSnapshot[BlogAuditField];
      new: BlogAuditSnapshot[BlogAuditField];
    }
  >
>;

export interface BlogAuditLogSummary {
  id: string;
  blogId: string;
  blogTitle: string;
  actorId: string;
  postAuthorId: string;
  action: BlogAuditAction;
  createdAt: Date;
}

export interface BlogAuditLog extends BlogAuditLogSummary {
  changes: BlogAuditChanges;
  snapshot: BlogAuditSnapshot | null;
}

export interface BlogAuditLogPage {
  items: BlogAuditLogSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
