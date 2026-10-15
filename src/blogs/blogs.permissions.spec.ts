import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BlogsService } from './blogs.service.js';
import { BlogsRepository } from './blogs.repository.js';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogStatus } from './enums/blog-status.enum.js';
import { BlogImageStore } from './blog-image.store.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import type { UpdateBlogDto } from './dto/update-blog.dto.js';

describe('Blog ownership permissions', () => {
  const ownerId = randomUUID();
  const adminId = randomUUID();
  const user = (id: string, role: UserRole) => ({ id, role }) as AuthUser;
  let service: BlogsService;
  let blog: BlogEntity;
  let manager: {
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let images: BlogImageStore;
  beforeEach(() => {
    blog = Object.assign(new BlogEntity(), {
      id: randomUUID(),
      authorId: ownerId,
      author: { id: ownerId, displayName: 'Owner' },
      title: 'Original',
      slug: 'original',
      content: 'Original content',
      categoryId: null,
      category: null,
      tagLinks: [],
      status: BlogStatus.DRAFT,
      publicationBlocked: false,
      publishedAt: null,
      coverImageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    manager = {
      findOne: vi.fn().mockResolvedValue(blog),
      find: vi.fn().mockResolvedValue([]),
      save: vi.fn(),
      delete: vi.fn(),
    };
    const query = {
      leftJoin: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockImplementation(async () => blog),
    };
    const repository = {
      createQueryBuilder: () => query,
    } as unknown as Repository<BlogEntity>;
    const dataSource = {
      transaction: async (
        callback: (value: typeof manager) => Promise<unknown>,
      ) => callback(manager),
    } as unknown as DataSource;
    images = {
      save: vi.fn().mockResolvedValue('/images/cover.png'),
      discard: vi.fn(),
    } as unknown as BlogImageStore;
    service = new BlogsService(
      new BlogsRepository(repository, dataSource, images),
    );
  });

  it.each<UpdateBlogDto>([
    { title: 'Admin edit' },
    { content: 'Admin content' },
    { status: BlogStatus.PUBLISHED },
    { coverImageUrl: null },
  ])('denies admin edits to another author’s post: %j', async (dto) => {
    await expect(
      service.update(blog.id, dto, user(adminId, UserRole.ADMIN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(blog.title).toBe('Original');
    expect(blog.status).toBe(BlogStatus.DRAFT);
  });

  it('denies admin image-only changes before writing an upload', async () => {
    await expect(
      service.update(
        blog.id,
        {},
        user(adminId, UserRole.ADMIN),
        {} as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(images.save).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it.each([UserRole.AUTHOR, UserRole.ADMIN])(
    'allows owners with role %s to edit and publish',
    async (role) => {
      const result = await service.update(
        blog.id,
        { title: 'Owner edit', status: BlogStatus.PUBLISHED },
        user(ownerId, role),
      );
      expect(result.title).toBe('Owner edit');
      expect(result.status).toBe(BlogStatus.PUBLISHED);
      expect(manager.save).toHaveBeenCalled();
    },
  );

  it('still denies edits by another author', async () => {
    await expect(
      service.update(
        blog.id,
        { title: 'Other edit' },
        user(randomUUID(), UserRole.AUTHOR),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('retains admin access to read and delete another author’s post', async () => {
    const admin = user(adminId, UserRole.ADMIN);
    expect((await service.findOneForAdmin(blog.id, admin)).id).toBe(blog.id);
    await service.remove(blog.id, admin);
    expect(manager.delete).toHaveBeenCalledWith(BlogEntity, blog.id);
  });

  it('lets admins block publication and publish again without editing content', async () => {
    const admin = user(adminId, UserRole.ADMIN);
    const result = await service.updateStatusForAdmin(
      blog.id,
      { status: BlogStatus.DRAFT },
      admin,
    );
    expect(result.publicationBlocked).toBe(true);
    expect(blog.title).toBe('Original');
    expect(blog.content).toBe('Original content');
    expect(
      (
        await service.updateStatusForAdmin(
          blog.id,
          { status: BlogStatus.PUBLISHED },
          admin,
        )
      ).publicationBlocked,
    ).toBe(false);
  });

  it('blocks owner publishing before any upload and preserves the block through edits', async () => {
    blog.publicationBlocked = true;
    const owner = user(ownerId, UserRole.AUTHOR);
    await expect(
      service.update(
        blog.id,
        { status: BlogStatus.PUBLISHED },
        owner,
        {} as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(images.save).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(
      (await service.update(blog.id, { title: 'Fixed' }, owner))
        .publicationBlocked,
    ).toBe(true);
    await service.update(blog.id, { status: BlogStatus.DRAFT }, owner);
    await expect(
      service.update(blog.id, { status: BlogStatus.PUBLISHED }, owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies author moderation and client attempts to clear the publication block', async () => {
    const owner = user(ownerId, UserRole.AUTHOR);
    await expect(
      service.updateStatusForAdmin(
        blog.id,
        { status: BlogStatus.DRAFT },
        owner,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update(
        blog.id,
        { publicationBlocked: false } as unknown as UpdateBlogDto,
        owner,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.updateStatusForAdmin(
        blog.id,
        { status: BlogStatus.PUBLISHED, title: 'Changed' } as never,
        user(adminId, UserRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
