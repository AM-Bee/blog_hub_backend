import type { NotificationType } from '../enums/notification-type.enum.js';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  blogId: string;
  blogTitle: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  items: Notification[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}
