import { Inject, Injectable } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NotificationsRepository)
    private readonly repository: NotificationsRepository,
  ) {}

  findMine(userId: string, query: ListNotificationsQueryDto) {
    return this.repository.findMine(userId, query);
  }

  markRead(userId: string, id: string) {
    return this.repository.markRead(userId, id);
  }

  markAllRead(userId: string) {
    return this.repository.markAllRead(userId);
  }
}
