import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { NotificationsService } from './notifications.service.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import {
  NotificationPageResponseDto,
  NotificationResponseDto,
  MarkAllNotificationsReadResponseDto,
} from './dto/notification-response.dto.js';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List your notifications and total unread count' })
  @ApiOkResponse({ type: NotificationPageResponseDto })
  findMine(
    @Query(dtoValidationPipe(ListNotificationsQueryDto))
    query: ListNotificationsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.findMine(request.user.id, query);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all of your unread notifications as read' })
  @ApiOkResponse({ type: MarkAllNotificationsReadResponseDto })
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one of your notifications as read' })
  @ApiOkResponse({ type: NotificationResponseDto })
  markRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.markRead(request.user.id, id);
  }
}
