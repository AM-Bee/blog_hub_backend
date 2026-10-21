import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BlogEntity } from './entities/blog.entity.js';
import { BlogStatus } from './enums/blog-status.enum.js';
import { BlogTagEntity } from './entities/blog-tag.entity.js';
import { CategoryEntity } from '../categories/entities/category.entity.js';
import { TagEntity } from '../tags/entities/tag.entity.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { UpdateBlogDto } from './dto/update-blog.dto.js';
import { UpdateBlogStatusDto } from './dto/update-blog-status.dto.js';
import {
  BlogPaginationQueryDto,
  ListBlogsQueryDto,
  ManageBlogsQueryDto,
} from './dto/list-blogs-query.dto.js';
import type {
  BlogPage,
  Blog,
  BlogSummary,
} from './interfaces/blog.interface.js';
import type { AuthUser } from '../auth/interfaces/auth.interface.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { validateDto } from '../common/validation.utils.js';
import { taxonomySlug } from '../common/taxonomy.utils.js';
import { BlogImageStore } from './blog-image.store.js';
import { BlogAuditLogEntity } from './entities/blog-audit-log.entity.js';
import { NotificationEntity } from '../notifications/entities/notification.entity.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { BlogAuditAction } from './enums/blog-audit-action.enum.js';
import { ListBlogAuditLogsQueryDto } from './dto/list-blog-audit-logs-query.dto.js';
import type {
  BlogAuditSnapshot,
  BlogAuditChanges,
  BlogAuditField,
  BlogAuditLog,
  BlogAuditLogSummary,
  BlogAuditLogPage,
} from './interfaces/blog-audit-log.interface.js';

@Injectable()
export class BlogsRepository {
  constructor(
    @InjectRepository(BlogEntity)
    private readonly blogRepository: Repository<BlogEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(BlogImageStore)
    private readonly images: BlogImageStore = new BlogImageStore(),
  ) {}

  async create(
    input: CreateBlogDto,
    user: AuthUser,
    image?: Express.Multer.File,
  ): Promise<Blog> {
    this.assertWriter(user);
    const dto = await validateDto(input, CreateBlogDto);
    this.assertImageInput(dto, image);
    let imageUrl: string | undefined;
    let committed = false;
    try {
      const baseSlug = taxonomySlug(dto.title) || 'post';
      for (let attempt = 0; attempt < 3; attempt++) {
        const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomUUID()}`;
        try {
          const id = await this.dataSource.transaction(async (manager) => {
            await this.checkCategoryAndTags(
              manager,
              dto.categoryId,
              dto.tagIds ?? [],
            );
            if (image && !imageUrl) {
              imageUrl = await this.images.save(image);
            }
            const blog = manager.create(BlogEntity, {
              authorId: user.id,
              categoryId: dto.categoryId,
              title: dto.title,
              slug,
              content: dto.content,
              coverImageUrl: imageUrl ?? dto.coverImageUrl ?? null,
              status: dto.status ?? BlogStatus.DRAFT,
              publishedAt:
                dto.status === BlogStatus.PUBLISHED ? new Date() : null,
            });
            const saved = await manager.save(BlogEntity, blog);
            await this.replaceTags(manager, saved.id, dto.tagIds ?? []);
            return saved.id;
          });
          committed = true;
          return this.findDetail(id);
        } catch (error) {
          if (!this.isSlugConflict(error)) {
            throw error;
          }
        }
      }
      throw new ConflictException('Unable to generate a unique blog slug');
    } finally {
      if (imageUrl && !committed) {
        await this.images.discard(imageUrl);
      }
    }
  }

  async findAll(input: ListBlogsQueryDto): Promise<BlogPage> {
    const query = await validateDto(input, ListBlogsQueryDto);
    return this.list(query, { status: BlogStatus.PUBLISHED }, true, query);
  }

  async findOne(slug: string): Promise<Blog> {
    const blog = await this.viewQuery()
      .where('blog.slug = :slug', { slug })
      .andWhere('blog.status = :status', { status: BlogStatus.PUBLISHED })
      .getOne();
    if (!blog) {
      throw new NotFoundException('Blog not found');
    }
    return this.toResponse(blog);
  }

  async findMine(
    input: ManageBlogsQueryDto,
    user: AuthUser,
  ): Promise<BlogPage> {
    const query = await validateDto(input, ManageBlogsQueryDto);
    return this.list(
      query,
      { authorId: user.id, ...(query.status ? { status: query.status } : {}) },
      false,
    );
  }

  async findMyOne(id: string, user: AuthUser): Promise<Blog> {
    const blog = await this.findDetailEntity(id);
    if (blog.authorId !== user.id) {
      throw new ForbiddenException('You can only read your own drafts here');
    }
    return this.toResponse(blog);
  }

  async findMyAuditLogs(
    input: ListBlogAuditLogsQueryDto,
    user: AuthUser,
  ): Promise<BlogAuditLogPage> {
    const query = await validateDto(input, ListBlogAuditLogsQueryDto);
    const [logs, total] = await this.dataSource
      .getRepository(BlogAuditLogEntity)
      .findAndCount({
        where: { actorId: user.id },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
    return {
      items: logs.map((log) => this.auditSummary(log)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findMyAuditLog(id: string, user: AuthUser): Promise<BlogAuditLog> {
    const log = await this.dataSource
      .getRepository(BlogAuditLogEntity)
      .createQueryBuilder('audit')
      .addSelect(['audit.changes', 'audit.snapshot'])
      .where('audit.id = :id AND audit.actorId = :actorId', {
        id,
        actorId: user.id,
      })
      .getOne();
    if (!log) {
      throw new NotFoundException('Audit log not found');
    }
    return {
      ...this.auditSummary(log),
      changes: log.changes,
      snapshot: log.snapshot,
    };
  }

  async findAllForAdmin(
    input: ManageBlogsQueryDto,
    user: AuthUser,
  ): Promise<BlogPage> {
    this.assertAdmin(user);
    const query = await validateDto(input, ManageBlogsQueryDto);
    return this.list(
      query,
      query.status ? { status: query.status } : {},
      false,
    );
  }

  async findOneForAdmin(id: string, user: AuthUser): Promise<Blog> {
    this.assertAdmin(user);
    return this.findDetail(id);
  }

  async updateStatusForAdmin(
    id: string,
    input: UpdateBlogStatusDto,
    user: AuthUser,
  ): Promise<Blog> {
    this.assertAdmin(user);
    const dto = await validateDto(input, UpdateBlogStatusDto);
    await this.dataSource.transaction(async (manager) => {
      const blog = await manager.findOne(BlogEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!blog) {
        throw new NotFoundException('Blog not found');
      }
      const before = await this.auditSnapshot(manager, id);
      blog.status = dto.status;
      blog.publicationBlocked = dto.status === BlogStatus.DRAFT;
      if (dto.status === BlogStatus.PUBLISHED && !blog.publishedAt) {
        blog.publishedAt = new Date();
      }
      await manager.save(BlogEntity, blog);
      await this.recordAudit(
        manager,
        user,
        before,
        await this.auditSnapshot(manager, id),
      );
      if (
        blog.authorId !== user.id &&
        dto.status === BlogStatus.DRAFT &&
        (before.status !== BlogStatus.DRAFT || !before.publicationBlocked)
      ) {
        await manager.insert(NotificationEntity, {
          userId: blog.authorId,
          type: NotificationType.POST_UNPUBLISHED,
          blogId: blog.id,
          blogTitle: blog.title,
          message: `An admin unpublished your post "${blog.title}". You can edit it, but only an admin can publish it again.`,
          readAt: null,
        });
      }
    });
    return this.findDetail(id);
  }

  async update(
    id: string,
    input: UpdateBlogDto,
    user: AuthUser,
    image?: Express.Multer.File,
  ): Promise<Blog> {
    this.assertWriter(user);
    const dto = await validateDto(input, UpdateBlogDto);
    this.assertImageInput(dto, image);
    if (!image && !Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('Provide at least one editable field');
    }
    let imageUrl: string | undefined;
    let committed = false;
    try {
      await this.dataSource.transaction(async (manager) => {
        const blog = await manager.findOne(BlogEntity, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!blog) {
          throw new NotFoundException('Blog not found');
        }
        this.assertOwner(blog, user);
        if (blog.publicationBlocked && dto.status === BlogStatus.PUBLISHED) {
          throw new ForbiddenException(
            'This post was unpublished by an admin. Only an admin can publish it through the admin status route.',
          );
        }
        const before = await this.auditSnapshot(manager, id);
        const categoryId = dto.categoryId ?? blog.categoryId;
        const categoryChanged =
          dto.categoryId !== undefined && dto.categoryId !== blog.categoryId;
        let tagIds = dto.tagIds;
        if (categoryChanged && tagIds === undefined) {
          tagIds = [];
        }
        const currentLinks =
          tagIds === undefined
            ? await manager.find(BlogTagEntity, { where: { blogId: id } })
            : [];
        await this.checkCategoryAndTags(
          manager,
          categoryId,
          tagIds ?? currentLinks.map((link) => link.tagId),
        );
        if (image) {
          imageUrl = await this.images.save(image);
        }
        if (dto.title !== undefined) {
          blog.title = dto.title;
        }
        if (dto.content !== undefined) {
          blog.content = dto.content;
        }
        if (dto.coverImageUrl !== undefined) {
          blog.coverImageUrl = dto.coverImageUrl;
        }
        if (imageUrl) {
          blog.coverImageUrl = imageUrl;
        }
        blog.categoryId = categoryId;
        if (dto.status !== undefined) {
          blog.status = dto.status;
          if (dto.status === BlogStatus.PUBLISHED && !blog.publishedAt) {
            blog.publishedAt = new Date();
          }
        }
        // Blog slugs remain stable on title edits, as specified in the blog plan.
        await manager.save(BlogEntity, blog);
        if (tagIds !== undefined) {
          await this.replaceTags(manager, id, tagIds);
        }
        await this.recordAudit(
          manager,
          user,
          before,
          await this.auditSnapshot(manager, id),
        );
      });
      committed = true;
    } finally {
      if (imageUrl && !committed) {
        await this.images.discard(imageUrl);
      }
    }
    return this.findDetail(id);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    this.assertWriter(user);
    await this.dataSource.transaction(async (manager) => {
      const blog = await manager.findOne(BlogEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!blog) {
        throw new NotFoundException('Blog not found');
      }
      this.assertOwnerOrAdmin(blog, user);
      const before = await this.auditSnapshot(manager, id);
      await this.recordAudit(manager, user, before, null);
      if (user.role === UserRole.ADMIN && blog.authorId !== user.id) {
        await manager.insert(NotificationEntity, {
          userId: blog.authorId,
          type: NotificationType.POST_DELETED,
          blogId: blog.id,
          blogTitle: blog.title,
          message: `An admin deleted your post "${blog.title}".`,
          readAt: null,
        });
      }
      await manager.delete(BlogEntity, id);
    });
  }

  private async checkCategoryAndTags(
    manager: EntityManager,
    categoryId: string | null,
    tagIds: string[],
  ): Promise<void> {
    if (categoryId === null) {
      if (tagIds.length) {
        throw new BadRequestException('Choose a category before adding tags');
      }
      return;
    }
    const category = await manager.findOne(CategoryEntity, {
      where: { id: categoryId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    if (!tagIds.length) {
      return;
    }
    const tags = await manager
      .getRepository(TagEntity)
      .createQueryBuilder('tag')
      .where('tag.id IN (:...tagIds)', { tagIds })
      .andWhere('tag.categoryId = :categoryId', { categoryId })
      .setLock('pessimistic_read')
      .getMany();
    if (tags.length !== tagIds.length) {
      throw new BadRequestException(
        'Every tag must exist and belong to the selected category',
      );
    }
  }

  private async replaceTags(
    manager: EntityManager,
    blogId: string,
    tagIds: string[],
  ): Promise<void> {
    await manager.delete(BlogTagEntity, { blogId });
    if (tagIds.length) {
      await manager.insert(
        BlogTagEntity,
        tagIds.map((tagId) => ({ blogId, tagId })),
      );
    }
  }

  private viewQuery(manager?: EntityManager) {
    const repository = manager
      ? manager.getRepository(BlogEntity)
      : this.blogRepository;
    return repository
      .createQueryBuilder('blog')
      .leftJoin('blog.author', 'author')
      .addSelect(['author.id', 'author.displayName'])
      .leftJoinAndSelect('blog.category', 'category')
      .leftJoinAndSelect('blog.tagLinks', 'tagLink')
      .leftJoinAndSelect('tagLink.tag', 'tag');
  }

  private async auditSnapshot(
    manager: EntityManager,
    id: string,
  ): Promise<BlogAuditSnapshot> {
    // Read through the transaction's manager, after locking the post row.
    const blog = await this.viewQuery(manager)
      .where('blog.id = :id', { id })
      .getOne();
    if (!blog) {
      throw new NotFoundException('Blog not found');
    }
    const { author, publishedAt, createdAt, updatedAt, ...post } =
      this.toResponse(blog);
    return {
      ...post,
      authorId: author.id,
      publishedAt: publishedAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  private async recordAudit(
    manager: EntityManager,
    user: AuthUser,
    before: BlogAuditSnapshot,
    after: BlogAuditSnapshot | null,
  ): Promise<void> {
    const changes: BlogAuditChanges = {};
    let action = BlogAuditAction.DELETED;
    if (after) {
      const fields: BlogAuditField[] = [
        'title',
        'content',
        'category',
        'tags',
        'coverImageUrl',
        'status',
        'publicationBlocked',
        'publishedAt',
      ];
      for (const field of fields) {
        // Taxonomy labels can be renamed separately; compare relationships by ID.
        let oldValue: unknown = before[field];
        let newValue: unknown = after[field];
        if (field === 'category') {
          oldValue = before.categoryId;
          newValue = after.categoryId;
        } else if (field === 'tags') {
          oldValue = before.tags.map((tag) => tag.id).sort();
          newValue = after.tags.map((tag) => tag.id).sort();
        }
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes[field] = { old: before[field], new: after[field] };
        }
      }
      if (!Object.keys(changes).length) {
        return;
      }
      action = BlogAuditAction.UPDATED;
      if (changes.status || changes.publicationBlocked) {
        action =
          after.status === BlogStatus.PUBLISHED
            ? BlogAuditAction.PUBLISHED
            : BlogAuditAction.UNPUBLISHED;
      }
    }
    await manager.insert(BlogAuditLogEntity, {
      blogId: before.id,
      blogTitle: after?.title ?? before.title,
      actorId: user.id,
      postAuthorId: before.authorId,
      action,
      changes,
      snapshot: after ? null : before,
    });
  }

  private auditSummary(log: BlogAuditLogEntity): BlogAuditLogSummary {
    return {
      id: log.id,
      blogId: log.blogId,
      blogTitle: log.blogTitle,
      actorId: log.actorId,
      postAuthorId: log.postAuthorId,
      action: log.action,
      createdAt: log.createdAt,
    };
  }

  private async findDetailEntity(id: string): Promise<BlogEntity> {
    const blog = await this.viewQuery().where('blog.id = :id', { id }).getOne();
    if (!blog) {
      throw new NotFoundException('Blog not found');
    }
    return blog;
  }

  private async findDetail(id: string): Promise<Blog> {
    return this.toResponse(await this.findDetailEntity(id));
  }

  private async list(
    query: BlogPaginationQueryDto,
    filters: { authorId?: string; status?: BlogStatus },
    publishedOrder: boolean,
    search?: ListBlogsQueryDto,
  ): Promise<BlogPage> {
    // Filter and page posts before loading tags so links cannot multiply results.
    const listing = this.blogRepository
      .createQueryBuilder('blog')
      .where(filters);
    if (search?.q) {
      listing.andWhere(
        '(blog.title ILIKE :search OR blog.content ILIKE :search)',
        {
          search: this.containsPattern(search.q),
        },
      );
    }
    if (search?.category) {
      listing
        .innerJoin('blog.category', 'filterCategory')
        .andWhere('filterCategory.slug = :category', {
          category: search.category,
        });
    }
    if (search?.author) {
      listing
        .innerJoin('blog.author', 'filterAuthor')
        .andWhere('filterAuthor.displayName ILIKE :author', {
          author: this.containsPattern(search.author),
        });
    }
    if (search?.tag) {
      const tagMatch = listing
        .subQuery()
        .select('1')
        .from(BlogTagEntity, 'filterLink')
        .innerJoin('filterLink.tag', 'filterTag')
        .where('filterLink.blogId = blog.id')
        .andWhere('filterTag.slug = :tag')
        .getQuery();
      listing.andWhere(`EXISTS ${tagMatch}`, { tag: search.tag });
    }
    const [blogs, total] = await listing
      .orderBy(publishedOrder ? 'blog.publishedAt' : 'blog.createdAt', 'DESC')
      .addOrderBy('blog.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    const loaded = blogs.length
      ? await this.viewQuery()
          .where({ id: In(blogs.map((blog) => blog.id)) })
          .getMany()
      : [];
    const byId = new Map(loaded.map((blog) => [blog.id, blog]));
    const items: BlogSummary[] = [];
    for (const row of blogs) {
      const blog = byId.get(row.id);
      // Recheck status after the second query so concurrent unpublishing cannot expose drafts.
      if (!blog || (publishedOrder && blog.status !== BlogStatus.PUBLISHED)) {
        continue;
      }
      const { content, ...response } = this.toResponse(blog);
      items.push({ ...response, excerpt: [...content].slice(0, 200).join('') });
    }
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  private containsPattern(value: string): string {
    // Treat LIKE wildcards as literal user text; values are bound parameters.
    return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
  }

  private toResponse(blog: BlogEntity): Blog {
    return {
      id: blog.id,
      title: blog.title,
      slug: blog.slug,
      content: blog.content,
      author: { id: blog.author.id, displayName: blog.author.displayName },
      categoryId: blog.categoryId,
      category: blog.category
        ? {
            id: blog.category.id,
            name: blog.category.name,
            slug: blog.category.slug,
          }
        : null,
      categoryName: blog.category?.name ?? 'Uncategorized',
      tags: (blog.tagLinks ?? [])
        .filter((link) => link.tag)
        .map((link) => ({
          id: link.tag.id,
          name: link.tag.name,
          slug: link.tag.slug,
          categoryId: link.tag.categoryId,
        }))
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
      coverImageUrl: blog.coverImageUrl,
      status: blog.status,
      publicationBlocked: blog.publicationBlocked,
      publishedAt: blog.publishedAt,
      createdAt: blog.createdAt,
      updatedAt: blog.updatedAt,
    };
  }

  private assertImageInput(
    dto: { coverImageUrl?: string | null },
    image?: Express.Multer.File,
  ): void {
    if (image && dto.coverImageUrl !== undefined) {
      throw new BadRequestException(
        'Send either image or coverImageUrl, not both',
      );
    }
  }

  private assertWriter(user: AuthUser): void {
    if (![UserRole.AUTHOR, UserRole.ADMIN].includes(user.role)) {
      throw new ForbiddenException('Author or admin access is required');
    }
  }
  private assertAdmin(user: AuthUser): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access is required');
    }
  }
  private assertOwner(blog: BlogEntity, user: AuthUser): void {
    if (blog.authorId !== user.id) {
      throw new ForbiddenException('You can only edit your own blogs');
    }
  }
  private assertOwnerOrAdmin(blog: BlogEntity, user: AuthUser): void {
    if (user.role !== UserRole.ADMIN && blog.authorId !== user.id) {
      throw new ForbiddenException('You can only manage your own blogs');
    }
  }
  private isSlugConflict(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };
    return (
      driverError.code === '23505' && driverError.constraint === 'UQ_blogs_slug'
    );
  }
}
