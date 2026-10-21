import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '../enums/notification-type.enum.js';
import type {
  Notification,
  NotificationPage,
} from '../interfaces/notification.interface.js';

export class NotificationResponseDto implements Notification {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ enum: NotificationType }) type: NotificationType;
  @ApiProperty({ format: 'uuid' }) blogId: string;
  @ApiProperty() blogTitle: string;
  @ApiProperty() message: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class NotificationPageResponseDto implements NotificationPage {
  @ApiProperty({ type: [NotificationResponseDto] })
  items: NotificationResponseDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
  @ApiProperty({
    description: 'All unread notifications for this user, across all pages',
  })
  unreadCount: number;
}

export class MarkAllNotificationsReadResponseDto {
  @ApiProperty() message: string;
  @ApiProperty({ description: 'Number of notifications newly marked as read' })
  updated: number;
}
