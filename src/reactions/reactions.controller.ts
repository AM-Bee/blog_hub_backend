import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
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
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import type { OptionalAuthenticatedRequest } from '../auth/guards/optional-jwt-auth.guard.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { ReactionSummaryDto, ToggleReactionDto } from './dto/reaction.dto.js';
import { ReactionsService } from './reactions.service.js';

@ApiTags('reactions')
@Controller()
export class ReactionsController {
  constructor(
    @Inject(ReactionsService) private readonly reactions: ReactionsService,
  ) {}

  @Get('blogs/:id/reactions')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Public blog reaction counts; optional Bearer token includes your reaction',
  })
  @ApiOkResponse({ type: ReactionSummaryDto })
  blog(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.reactions.get('blogId', id, request.user?.id);
  }

  @Get('comments/:id/reactions')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Public comment/reply reaction counts; optional Bearer token includes your reaction',
  })
  @ApiOkResponse({ type: ReactionSummaryDto })
  comment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.reactions.get('commentId', id, request.user?.id);
  }

  @Post('blogs/:id/reactions')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Toggle your blog reaction; same type removes it, different type replaces it',
  })
  @ApiOkResponse({ type: ReactionSummaryDto })
  toggleBlog(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(ToggleReactionDto)) input: ToggleReactionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reactions.toggle('blogId', id, request.user.id, input);
  }

  @Post('comments/:id/reactions')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Toggle your comment/reply reaction; same type removes it, different type replaces it',
  })
  @ApiOkResponse({ type: ReactionSummaryDto })
  toggleComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(ToggleReactionDto)) input: ToggleReactionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reactions.toggle('commentId', id, request.user.id, input);
  }
}
