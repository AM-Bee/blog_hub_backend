import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { BlogsRepository } from './blogs.repository.js';
import { PostSyncOperationEntity } from './entities/post-sync-operation.entity.js';
import type { PostSyncResult } from './entities/post-sync-operation.entity.js';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogImageStore } from './blog-image.store.js';
import { SyncPostDto } from './dto/sync-post.dto.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { UpdateBlogDto } from './dto/update-blog.dto.js';
import { validateDto } from '../common/validation.utils.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';

export function syncRequestHash(
  dto: SyncPostDto,
  image?: Express.Multer.File,
): string {
  const input = Object.fromEntries(
    Object.entries(dto.input ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256')
    .update(
      JSON.stringify({
        entityId: dto.entityId,
        type: dto.type,
        baseVersion: dto.baseVersion ?? null,
        input,
        image: image
          ? {
              hash: createHash('sha256').update(image.buffer).digest('hex'),
              mimeType: image.mimetype,
            }
          : null,
      }),
    )
    .digest('hex');
}

@Injectable()
export class PostSyncService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(BlogsRepository) private readonly posts: BlogsRepository,
    @Inject(BlogImageStore) private readonly images: BlogImageStore,
  ) {}

  async apply(input: SyncPostDto, user: AuthUser, image?: Express.Multer.File) {
    const dto = await validateDto(input, SyncPostDto);
    if (dto.type !== 'CREATE' && !Number.isInteger(dto.baseVersion)) {
      throw new BadRequestException(
        'baseVersion is required for edits and deletion',
      );
    }
    if (dto.type === 'DELETE' && (dto.input !== undefined || image)) {
      throw new BadRequestException(
        'Delete operations cannot include post content or images',
      );
    }
    const hash = syncRequestHash(dto, image);
    const uploaded: string[] = [];
    let committed = false;
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // Serialize identical retries before reading the receipt or uploading a cover.
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${user.id}:${dto.operationId}`],
        );
        const receipt = await manager.findOneBy(PostSyncOperationEntity, {
          userId: user.id,
          operationId: dto.operationId,
        });
        if (receipt) {
          if (receipt.requestHash !== hash) {
            throw new ConflictException(
              'This operation ID was already used with different content',
            );
          }
          return receipt.result;
        }
        // Different operation IDs can still create/delete the same stable entity concurrently.
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`blog-sync:${dto.entityId}`],
        );
        const current = await manager.findOne(BlogEntity, {
          where: { id: dto.entityId },
          withDeleted: true,
          lock: { mode: 'pessimistic_write' },
        });
        if (current && current.authorId !== user.id) {
          throw new ForbiddenException();
        }
        if (dto.type === 'CREATE' && current) {
          throw new ConflictException('A post with this ID already exists');
        }
        if (dto.type === 'UPDATE' && (!current || current.deletedAt)) {
          throw new NotFoundException('This post was deleted on the server');
        }
        if (
          current &&
          !current.deletedAt &&
          dto.type !== 'CREATE' &&
          current.version !== dto.baseVersion
        ) {
          throw new ConflictException(
            'This post changed on another device. Review the server version before retrying.',
          );
        }
        let response: PostSyncResult;
        if (dto.type === 'CREATE') {
          const fields = await validateDto(dto.input ?? {}, CreateBlogDto);
          response = {
            blog: await this.posts.create(fields, user, image, {
              manager,
              id: dto.entityId,
              uploaded,
            }),
          };
        } else if (dto.type === 'UPDATE') {
          const fields = await validateDto(dto.input ?? {}, UpdateBlogDto);
          response = {
            blog: await this.posts.update(dto.entityId, fields, user, image, {
              manager,
              uploaded,
            }),
          };
        } else {
          if (current && !current.deletedAt)
            await this.posts.remove(dto.entityId, user, manager);
          response = { deleted: true, id: dto.entityId };
        }
        await manager.insert(PostSyncOperationEntity, {
          userId: user.id,
          operationId: dto.operationId,
          requestHash: hash,
          result: response,
        });
        return response;
      });
      committed = true;
      return result;
    } finally {
      if (!committed) {
        for (const url of uploaded) {
          await this.images.discard(url);
        }
      }
    }
  }
}
