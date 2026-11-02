import type { BlogAuthor } from '../../blogs/interfaces/blog.interface.js';

export interface BlogComment {
  id: string;
  blogId: string;
  parentId: string | null;
  author: BlogAuthor;
  content: string;
  replyCount: number;
  likeCount: number;
  dislikeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommentPage {
  items: BlogComment[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
