import 'reflect-metadata';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { UserEntity } from './users/entities/user.entity.js';
import { UserRole } from './users/enums/user-role.enum.js';
import { CategoryEntity } from './categories/entities/category.entity.js';
import { TagEntity } from './tags/entities/tag.entity.js';
import { BlogEntity } from './blogs/entities/blog.entity.js';
import { BlogStatus } from './blogs/enums/blog-status.enum.js';
import { BlogTagEntity } from './blogs/entities/blog-tag.entity.js';
import { RefreshSessionEntity } from './auth/entities/refresh-session.entity.js';
import { RefreshTokenEntity } from './auth/entities/refresh-token.entity.js';
import {
  normalizeTaxonomyName,
  taxonomySlug,
} from './common/taxonomy.utils.js';

export const seedEntities = [
  UserEntity,
  CategoryEntity,
  TagEntity,
  BlogEntity,
  BlogTagEntity,
  RefreshSessionEntity,
  RefreshTokenEntity,
];

// Stable IDs make reruns safe even when sample records are edited or renamed.
const seedId = (key: string): string => {
  const hex = createHash('sha256')
    .update(`bloghub-demo-v1:${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const users = [
  {
    key: 'admin',
    email: 'demo-admin@bloghub.example',
    displayName: 'Demo Admin',
    role: UserRole.ADMIN,
  },
  {
    key: 'bee',
    email: 'demo-bee@bloghub.example',
    displayName: 'Bee Writer',
    role: UserRole.AUTHOR,
  },
  {
    key: 'alan',
    email: 'demo-alan@bloghub.example',
    displayName: 'Alan Chen',
    role: UserRole.AUTHOR,
  },
];
const categories = [
  { name: 'Dancing', tags: ['Ballet', 'Beginner'] },
  { name: 'Web Development', tags: ['NestJS', 'TypeScript', 'Beginner'] },
  { name: 'Travel', tags: ['City Guides', 'Budget Travel'] },
  { name: 'Cooking', tags: ['Quick Meals', 'Baking'] },
];
const posts = [
  {
    title: 'Ballet basics for beginners',
    category: 0,
    tags: [0, 1],
    author: 'bee',
    text: 'Learn ballet posture, balance, and your first steps.',
  },
  {
    title: 'Building a daily dance routine',
    category: 0,
    tags: [1],
    author: 'alan',
    text: 'Start with a warm-up and build a consistent dancing routine.',
  },
  {
    title: 'My next ballet lesson',
    category: 0,
    tags: [0],
    author: 'bee',
    text: 'Notes for an upcoming ballet lesson.',
    draft: true,
  },
  {
    title: 'Getting started with NestJS',
    category: 1,
    tags: [0, 2],
    author: 'bee',
    text: 'Create modules, controllers, and services in a NestJS backend.',
  },
  {
    title: 'TypeScript tips for backend developers',
    category: 1,
    tags: [1],
    author: 'alan',
    text: 'Use types to make API contracts easier to understand.',
  },
  {
    title: 'Planning a new API feature',
    category: 1,
    tags: [0, 1],
    author: 'admin',
    text: 'A private draft for the next backend feature.',
    draft: true,
  },
  {
    title: 'A weekend city guide',
    category: 2,
    tags: [0],
    author: 'alan',
    text: 'Explore local markets, parks, and favorite cafes.',
  },
  {
    title: 'Travel comfortably on a budget',
    category: 2,
    tags: [1],
    author: 'bee',
    text: 'Plan transport and meals before your next trip.',
  },
  {
    title: 'Quick meals for busy evenings',
    category: 3,
    tags: [0],
    author: 'bee',
    text: 'Prepare a simple dinner with fresh ingredients in thirty minutes.',
  },
  {
    title: 'Your first homemade bread',
    category: 3,
    tags: [1],
    author: 'alan',
    text: 'Learn baking fundamentals with a simple bread recipe.',
  },
];

export async function seedData(dataSource: DataSource, password: string) {
  if ([...password].length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error(
      'SEED_PASSWORD must be at least 8 characters and at most 72 UTF-8 bytes',
    );
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const created = {
    users: 0,
    categories: 0,
    tags: 0,
    blogs: 0,
    blog_tags: 0,
    refresh_sessions: 0,
    refresh_tokens: 0,
  };

  await dataSource.transaction(async (manager) => {
    // Serialize simultaneous runs of this seed without blocking normal API reads.
    await manager.query('SELECT pg_advisory_xact_lock($1)', [53002026]);
    const authors = new Map<string, UserEntity>();
    for (const sample of users) {
      const id = seedId(`user:${sample.key}`);
      let user = await manager.findOneBy(UserEntity, { id });
      if (!user) {
        if (await manager.existsBy(UserEntity, { email: sample.email })) {
          throw new Error(
            `Demo email ${sample.email} belongs to an existing account; no records were changed`,
          );
        }
        user = await manager.save(UserEntity, {
          id,
          email: sample.email,
          displayName: sample.displayName,
          role: sample.role,
          passwordHash,
        });
        created.users++;
      }
      authors.set(sample.key, user);
    }

    const taxonomy: { category: CategoryEntity; tags: TagEntity[] }[] = [];
    for (const sample of categories) {
      const name = normalizeTaxonomyName(sample.name);
      const normalizedName = name.toLowerCase();
      const id = seedId(`category:${sample.name}`);
      let category =
        (await manager.findOneBy(CategoryEntity, { id })) ??
        (await manager.findOneBy(CategoryEntity, { normalizedName }));
      if (!category) {
        category = await manager.save(CategoryEntity, {
          id,
          name,
          normalizedName,
          slug: await uniqueSlug(manager, CategoryEntity, name, id),
          createdById: authors.get('admin')!.id,
        });
        created.categories++;
      }
      const tags: TagEntity[] = [];
      for (const tagName of sample.tags) {
        const tagId = seedId(`tag:${sample.name}:${tagName}`);
        let tag =
          (await manager.findOneBy(TagEntity, { id: tagId })) ??
          (await manager.findOneBy(TagEntity, {
            categoryId: category.id,
            normalizedName: tagName.toLowerCase(),
          }));
        if (tag && tag.categoryId !== category.id) {
          throw new Error(
            'A sample tag belongs to a different category; no records were changed',
          );
        }
        if (!tag) {
          tag = await manager.save(TagEntity, {
            id: tagId,
            name: tagName,
            normalizedName: tagName.toLowerCase(),
            slug: await uniqueSlug(manager, TagEntity, tagName, tagId),
            categoryId: category.id,
            createdById: authors.get('bee')!.id,
          });
          created.tags++;
        }
        tags.push(tag);
      }
      taxonomy.push({ category, tags });
    }

    for (const [index, sample] of posts.entries()) {
      const id = seedId(`blog:${sample.title}`);
      if (await manager.existsBy(BlogEntity, { id })) {
        continue;
      }
      const group = taxonomy[sample.category];
      const publishedAt = sample.draft
        ? null
        : new Date(Date.UTC(2026, 8, 20 + index, 8));
      await manager.insert(BlogEntity, {
        id,
        authorId: authors.get(sample.author)!.id,
        categoryId: group.category.id,
        title: sample.title,
        slug: await uniqueSlug(manager, BlogEntity, sample.title, id),
        content: `# ${sample.title}\n\n${sample.text}\n\nThis sample post is part of the BlogHub demo dataset.`,
        coverImageUrl: null,
        status: sample.draft ? BlogStatus.DRAFT : BlogStatus.PUBLISHED,
        publishedAt,
      });
      created.blogs++;
      for (const tagIndex of sample.tags) {
        await manager.insert(BlogTagEntity, {
          blogId: id,
          tagId: group.tags[tagIndex].id,
        });
        created.blog_tags++;
      }
    }

    // Populate auth tables with expired, revoked fixtures; they cannot authenticate.
    const expiredAt = new Date('2020-01-02T00:00:00Z');
    for (const [key, user] of authors) {
      const id = seedId(`session:${key}`);
      if (!(await manager.existsBy(RefreshSessionEntity, { id }))) {
        await manager.insert(RefreshSessionEntity, {
          id,
          userId: user.id,
          expiresAt: expiredAt,
          revokedAt: expiredAt,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        });
        created.refresh_sessions++;
      }
      const tokenHash = createHash('sha256')
        .update(`bloghub-expired-demo-token:${key}`)
        .digest('hex');
      if (!(await manager.existsBy(RefreshTokenEntity, { tokenHash }))) {
        await manager.insert(RefreshTokenEntity, {
          tokenHash,
          sessionId: id,
          usedAt: expiredAt,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        });
        created.refresh_tokens++;
      }
    }
  });
  return created;
}

async function uniqueSlug(
  manager: EntityManager,
  entity: typeof CategoryEntity | typeof TagEntity | typeof BlogEntity,
  name: string,
  id: string,
): Promise<string> {
  const base = taxonomySlug(name);
  return (await manager.getRepository(entity).existsBy({ slug: base }))
    ? `${base}-${id}`
    : base;
}

async function main() {
  dotenv.config({ quiet: true });
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seeding is for local development');
  }
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: seedEntities,
    synchronize: false,
    installExtensions: false,
  });
  try {
    await dataSource.initialize();
    const created = await seedData(
      dataSource,
      process.env.SEED_PASSWORD ?? 'BlogHubDemo2026!',
    );
    console.log('Demo seed completed. Newly created records:', created);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    const failure = error as { code?: string; message?: string };
    console.error('Demo seed failed:', failure.code ?? failure.message);
    process.exitCode = 1;
  });
}
