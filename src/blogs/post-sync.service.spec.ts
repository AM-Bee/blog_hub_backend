import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { PostSyncService, syncRequestHash } from './post-sync.service.js';
import type { BlogsRepository } from './blogs.repository.js';
import type { BlogImageStore } from './blog-image.store.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import type { SyncPostDto } from './dto/sync-post.dto.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UserStatus } from '../users/enums/user-status.enum.js';

function fixture() {
  const user: AuthUser = {
    id: randomUUID(),
    displayName: 'Writer',
    email: 'writer@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let row: { id: string; authorId: string; version: number } | null = null;
  let failReceipt = false;
  const receipts = new Map<string, { requestHash: string; result: unknown }>();
  const manager = {
    query: vi.fn(async () => []),
    async findOneBy(
      _entity: unknown,
      where: { userId: string; operationId: string },
    ) {
      return receipts.get(`${where.userId}:${where.operationId}`) ?? null;
    },
    async insert(
      _entity: unknown,
      receipt: {
        userId: string;
        operationId: string;
        requestHash: string;
        result: unknown;
      },
    ) {
      if (failReceipt) throw new Error('Receipt write failed');
      receipts.set(`${receipt.userId}:${receipt.operationId}`, {
        requestHash: receipt.requestHash,
        result: receipt.result,
      });
    },
    async findOne() {
      return row;
    },
  };
  const dataSource = {
    async transaction(task: (manager: EntityManager) => Promise<unknown>) {
      const before = row ? { ...row } : null;
      const beforeReceipts = new Map(receipts);
      try {
        return await task(manager as unknown as EntityManager);
      } catch (error) {
        row = before;
        receipts.clear();
        for (const [key, value] of beforeReceipts) receipts.set(key, value);
        throw error;
      }
    },
  };
  const posts = {
    create: vi.fn(
      async (
        _input: unknown,
        _user: AuthUser,
        image: unknown,
        write: { id: string; uploaded: string[] },
      ) => {
        if (image) write.uploaded.push('https://example.com/upload.jpg');
        row = { id: write.id, authorId: user.id, version: 1 };
        return { id: write.id, title: 'Story', version: 1 };
      },
    ),
    update: vi.fn(async () => ({
      id: row!.id,
      title: 'Edited',
      version: row!.version + 1,
    })),
    remove: vi.fn(async () => {
      row = null;
    }),
  };
  const images = { discard: vi.fn(async () => {}) };
  const service = new PostSyncService(
    dataSource as unknown as DataSource,
    posts as unknown as BlogsRepository,
    images as unknown as BlogImageStore,
  );
  const dto: SyncPostDto = {
    operationId: randomUUID(),
    entityId: randomUUID(),
    type: 'CREATE',
    input: {
      title: 'Story',
      content: 'Content',
      categoryId: randomUUID(),
      status: 'draft',
    },
  };
  return {
    user,
    dto,
    service,
    posts,
    images,
    receipts,
    set row(value: typeof row) {
      row = value;
    },
    set failReceipt(value: boolean) {
      failReceipt = value;
    },
  };
}

describe('post synchronization', () => {
  it('replays a confirmed operation without creating or uploading again and rejects reused IDs with different input', async () => {
    const f = fixture();
    const image = {
      buffer: Buffer.from('image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;
    const first = await f.service.apply(f.dto, f.user, image);
    expect(await f.service.apply(f.dto, f.user, image)).toEqual(first);
    expect(f.posts.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.apply(
        { ...f.dto, input: { ...f.dto.input, title: 'Different' } },
        f.user,
        image,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.posts.create).toHaveBeenCalledTimes(1);
  });

  it('rejects stale edits, other owners (including admins), and missing versions', async () => {
    const f = fixture();
    f.row = { id: f.dto.entityId, authorId: f.user.id, version: 2 };
    const update: SyncPostDto = {
      ...f.dto,
      type: 'UPDATE',
      baseVersion: 1,
      input: { title: 'Edited' },
    };
    await expect(f.service.apply(update, f.user)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      f.service.apply({ ...update, baseVersion: undefined }, f.user),
    ).rejects.toMatchObject({ status: 400 });
    f.row = { id: f.dto.entityId, authorId: randomUUID(), version: 1 };
    await expect(
      f.service.apply(update, { ...f.user, role: UserRole.ADMIN }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.posts.update).not.toHaveBeenCalled();
  });

  it('rolls the mutation back if its receipt cannot be saved and removes uncommitted covers', async () => {
    const f = fixture();
    f.failReceipt = true;
    const image = {
      buffer: Buffer.from('image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;
    await expect(f.service.apply(f.dto, f.user, image)).rejects.toThrow(
      'Receipt write failed',
    );
    expect(f.receipts.size).toBe(0);
    expect(f.images.discard).toHaveBeenCalledWith(
      'https://example.com/upload.jpg',
    );
    f.failReceipt = false;
    await f.service.apply(f.dto, f.user, image);
    expect(f.receipts.size).toBe(1);
  });

  it('acknowledges an already deleted post without recreating it', async () => {
    const f = fixture();
    const result = await f.service.apply(
      { ...f.dto, type: 'DELETE', input: undefined, baseVersion: 1 },
      f.user,
    );
    expect(result).toEqual({ deleted: true, id: f.dto.entityId });
    expect(f.posts.create).not.toHaveBeenCalled();
  });

  it('hashes editable fields independently of JSON key order, while detecting image and version changes', () => {
    const f = fixture();
    const a = { ...f.dto, input: { title: 'T', content: 'C' } };
    expect(syncRequestHash(a)).toBe(
      syncRequestHash({ ...a, input: { content: 'C', title: 'T' } }),
    );
    expect(syncRequestHash(a)).not.toBe(
      syncRequestHash({ ...a, baseVersion: 2 }),
    );
    expect(syncRequestHash(a)).not.toBe(
      syncRequestHash(a, {
        buffer: Buffer.from('image'),
      } as Express.Multer.File),
    );
  });
});

describe('sync request validation', () => {
  it('normalizes UUID casing so identical operations use the same advisory lock and receipt hash', async () => {
    const f = fixture();
    const result = await f.service.apply(f.dto, f.user);
    expect(
      await f.service.apply(
        {
          ...f.dto,
          operationId: f.dto.operationId.toUpperCase(),
          entityId: f.dto.entityId.toUpperCase(),
        },
        f.user,
      ),
    ).toEqual(result);
    expect(f.posts.create).toHaveBeenCalledTimes(1);
  });

  it.each([null, 0, -1, 1.5, 'invalid'])(
    'rejects invalid update versions %j',
    async (baseVersion) => {
      const f = fixture();
      await expect(
        f.service.apply(
          { ...f.dto, type: 'UPDATE', baseVersion } as SyncPostDto,
          f.user,
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('rejects deleted updates, invalid nested input, and delete content/images', async () => {
    const f = fixture();
    await expect(
      f.service.apply({ ...f.dto, type: 'UPDATE', baseVersion: 1 }, f.user),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.apply(
        { ...f.dto, input: { ...f.dto.input, authorId: randomUUID() } },
        f.user,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.apply({ ...f.dto, type: 'DELETE', baseVersion: 1 }, f.user),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.apply(
        { ...f.dto, type: 'DELETE', baseVersion: 1, input: undefined },
        f.user,
        { buffer: Buffer.from('image') } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.posts.create).not.toHaveBeenCalled();
  });
});
