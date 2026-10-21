import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import type { Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import type {
  Notification,
  NotificationPage,
} from './interfaces/notification.interface.js';
import { validateDto } from '../common/validation.utils.js';

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifications: Repository<NotificationEntity>,
  ) {}

  async findMine(
    userId: string,
    input: ListNotificationsQueryDto,
  ): Promise<NotificationPage> {
    const query = await validateDto(input, ListNotificationsQueryDto);
    const [[items, total], unreadCount] = await Promise.all([
      this.notifications.findAndCount({
        where: { userId },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.notifications.countBy({ userId, readAt: IsNull() }),
    ]);
    return {
      items: items.map((item) => this.toResponse(item)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      unreadCount,
    };
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    // Only unread rows belonging to this user can change; repeated reads preserve the first timestamp.
    await this.notifications.update(
      { id, userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    const item = await this.notifications.findOneBy({ id, userId });
    if (!item) {
      throw new NotFoundException('Notification not found');
    }
    return this.toResponse(item);
  }

  async markAllRead(userId: string) {
    const result = await this.notifications.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return {
      message: 'All notifications marked as read',
      updated: result.affected ?? 0,
    };
  }

  private toResponse(item: NotificationEntity): Notification {
    return {
      id: item.id,
      userId: item.userId,
      type: item.type,
      blogId: item.blogId,
      blogTitle: item.blogTitle,
      message: item.message,
      readAt: item.readAt,
      createdAt: item.createdAt,
    };
  }
}
