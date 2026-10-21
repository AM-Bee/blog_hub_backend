import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import type { Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity.js';

const store = {
  findAndCount: vi.fn(),
  countBy: vi.fn(),
  update: vi.fn(),
  findOneBy: vi.fn(),
};
const repository = new NotificationsRepository(
  store as unknown as Repository<NotificationEntity>,
);
beforeEach(() => vi.resetAllMocks());

it('returns recipient-scoped pages with the unread count across all pages', async () => {
  store.findAndCount.mockResolvedValue([[], 4]);
  store.countBy.mockResolvedValue(3);
  expect(
    await repository.findMine('current-user', { page: 2, limit: 2 }),
  ).toEqual({
    items: [],
    page: 2,
    limit: 2,
    total: 4,
    totalPages: 2,
    unreadCount: 3,
  });
  expect(store.findAndCount).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'current-user' },
      skip: 2,
      take: 2,
    }),
  );
  expect(store.countBy).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'current-user' }),
  );
});

it('does not expose or update a notification belonging to another recipient', async () => {
  store.findOneBy.mockResolvedValue(null);
  await expect(
    repository.markRead('current-user', 'notification-id'),
  ).rejects.toBeInstanceOf(NotFoundException);
  expect(store.update).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'notification-id', userId: 'current-user' }),
    expect.anything(),
  );
  expect(store.findOneBy).toHaveBeenCalledWith({
    id: 'notification-id',
    userId: 'current-user',
  });
});

it('marks only the current user unread notifications and reports affected rows', async () => {
  store.update.mockResolvedValue({ affected: 2 });
  expect(await repository.markAllRead('current-user')).toMatchObject({
    updated: 2,
  });
  expect(store.update).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'current-user',
      readAt: expect.anything(),
    }),
    expect.anything(),
  );
});

it.each([
  { page: '0' },
  { page: '1.2' },
  { page: '1000001' },
  { limit: '51' },
  { userId: 'another-user' },
])('rejects invalid pagination or recipient overrides: %j', async (query) => {
  await expect(
    dtoValidationPipe(ListNotificationsQueryDto).transform(query, {
      type: 'query',
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
});
