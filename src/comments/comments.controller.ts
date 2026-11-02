import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard.js';
import { BlogPaginationQueryDto } from '../blogs/dto/list-blogs-query.dto.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import {
  CommentContentDto,
  CommentPageResponseDto,
  CommentResponseDto,
} from './dto/comment.dto.js';
import { CommentsService } from './comments.service.js';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(
    @Inject(CommentsService) private readonly comments: CommentsService,
  ) {}

  @Get('blogs/:blogId/comments')
  @ApiOperation({
    summary: 'List top-level comments on a published blog, oldest first',
  })
  @ApiOkResponse({ type: CommentPageResponseDto })
  list(
    @Param('blogId', new ParseUUIDPipe()) blogId: string,
    @Query(dtoValidationPipe(BlogPaginationQueryDto))
    query: BlogPaginationQueryDto,
  ) {
    return this.comments.list(blogId, query);
  }

  @Get('comments/:id/replies')
  @ApiOperation({
    summary: 'List replies to a top-level comment, oldest first',
  })
  @ApiOkResponse({ type: CommentPageResponseDto })
  replies(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(dtoValidationPipe(BlogPaginationQueryDto))
    query: BlogPaginationQueryDto,
  ) {
    return this.comments.replies(id, query);
  }

  @Post('blogs/:blogId/comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: CommentResponseDto })
  create(
    @Param('blogId', new ParseUUIDPipe()) blogId: string,
    @Body(dtoValidationPipe(CommentContentDto)) input: CommentContentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.comments.create(blogId, request.user, input);
  }

  @Post('comments/:id/replies')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: CommentResponseDto })
  reply(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(CommentContentDto)) input: CommentContentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.comments.reply(id, request.user, input);
  }

  @Patch('comments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit your own comment or reply' })
  @ApiOkResponse({ type: CommentResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(dtoValidationPipe(CommentContentDto)) input: CommentContentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.comments.update(id, request.user, input);
  }

  @Delete('comments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete your own comment/reply; admins may delete any. Deleting a comment also deletes its replies.',
  })
  @ApiNoContentResponse()
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.comments.remove(id, request.user);
  }
}
