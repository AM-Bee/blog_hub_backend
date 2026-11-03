import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import migrationSource from '../database/data-source.js';
import { FaqEntity } from './entities/faq.entity.js';
import { FaqCategoryEntity } from './entities/faq-category.entity.js';

// These answers describe implemented features without assuming frontend screens.
export const initialFaqs = [
  {
    key: 'register',
    category: 'account',
    question: 'How do I register an account?',
    answer:
      'Register with your display name, email, and password. New accounts have the author role, which allows you to create your own posts.',
    alternativeQuestions: ['How do I sign up?', 'How do I create an account?'],
    keywords: ['register', 'create account', 'sign up'],
  },
  {
    key: 'login',
    category: 'account',
    question: 'How do I log in?',
    answer:
      'Sign in with the email address and password you used to register. You must be signed in to create posts, comment, reply, or react.',
    alternativeQuestions: [
      'How do I sign in?',
      'How do I login to my account?',
    ],
    keywords: ['login', 'sign in'],
  },
  {
    key: 'forgot-password',
    category: 'account',
    question: 'What if I forgot my password?',
    answer:
      'Password reset uses your email address, an emailed reset code, and a new password. Reset-code delivery depends on the site email service being available.',
    alternativeQuestions: ['How do I reset a forgotten password?'],
    keywords: ['forgot password', 'reset password', 'reset code'],
  },
  {
    key: 'change-password',
    category: 'account',
    question: 'How do I change my password?',
    answer:
      'While signed in, provide your current password and a new password. After a successful change, your existing sessions end and you must sign in again.',
    alternativeQuestions: ['Can I update my password?'],
    keywords: ['change password', 'current password', 'new password'],
  },
  {
    key: 'create-blog',
    category: 'blog-management',
    question: 'How do I create a blog post?',
    answer:
      'Sign in to create a post with a title, Markdown content, and a category. The post belongs to your account, and you can save it as a draft or publish it.',
    alternativeQuestions: [
      'How do I write an article?',
      'How do I create a post?',
    ],
    keywords: ['create blog', 'write post', 'new post'],
  },
  {
    key: 'edit-blog',
    category: 'blog-management',
    question: 'How do I edit my blog post?',
    answer:
      "You can edit your own posts while signed in. Admins cannot rewrite another author's content. Changing the title does not change the existing slug.",
    alternativeQuestions: ['How do I update an article?'],
    keywords: ['edit blog', 'update post', 'change title'],
  },
  {
    key: 'delete-blog',
    category: 'blog-management',
    question: 'Who can delete a blog post?',
    answer:
      'The post owner or an admin can delete a post. Deletion permanently removes its comments, replies, and reactions too.',
    alternativeQuestions: ['How do I delete my blog?', 'Can I remove my post?'],
    keywords: ['delete blog', 'remove post'],
  },
  {
    key: 'drafts',
    category: 'blog-management',
    question: 'Who can read my draft posts?',
    answer:
      'Drafts are hidden from public blog browsing and search. Authors can read their own drafts, and admins can access drafts for moderation.',
    alternativeQuestions: ['Are draft posts public?'],
    keywords: ['draft', 'draft privacy', 'unpublished'],
  },
  {
    key: 'unpublished',
    category: 'blog-management',
    question: 'Why can I not republish a post unpublished by an admin?',
    answer:
      'When an admin unpublishes a post, its author is blocked from publishing it again. Only an admin can clear this publishing restriction.',
    alternativeQuestions: [
      'Why is publishing blocked?',
      'An admin unpublished my post',
    ],
    keywords: ['publishing blocked', 'admin unpublished', 'republish'],
  },
  {
    key: 'images',
    category: 'blog-management',
    question: 'What cover images can I upload?',
    answer:
      'Blog cover images must be JPEG, PNG, or WebP and no larger than 5 MiB. You can provide a cover image when creating or editing your post.',
    alternativeQuestions: [
      'What image formats are supported?',
      'What is the image size limit?',
    ],
    keywords: ['image format', 'image size', 'cover image', 'upload image'],
  },
  {
    key: 'taxonomy',
    category: 'categories-and-tags',
    question: 'How are categories and tags related?',
    answer:
      "Each tag belongs to one category. When assigning tags to a blog, use tags from that blog's category. Authors can create categories and tags and edit their own; only admins can delete them.",
    alternativeQuestions: ['Can I use a tag from another category?'],
    keywords: ['category tag', 'categories tags', 'tag category'],
  },
  {
    key: 'search',
    category: 'search-and-navigation',
    question: 'How do I search published blogs?',
    answer:
      'You can search published posts by words in the title or content and filter them by category, tag, or author display name. Public search never includes drafts.',
    alternativeQuestions: [
      'How do I find articles?',
      'Can I filter blogs by author?',
    ],
    keywords: ['search blog', 'find article', 'filter author'],
  },
  {
    key: 'comments',
    category: 'general-support',
    question: 'How do comments and replies work?',
    answer:
      'Anyone can read comments on published posts. Signed-in users can comment and reply, with one level of replies. Writers can edit or delete their own items; admins can delete any. Deleting a comment also deletes its replies.',
    alternativeQuestions: ['Can I reply to a comment?'],
    keywords: ['comment reply', 'reply comment', 'comments'],
  },
  {
    key: 'reactions',
    category: 'general-support',
    question: 'How do likes and dislikes work?',
    answer:
      'Signed-in users can like or dislike published blogs, comments, and replies. Choosing the other reaction replaces your current one; choosing the same reaction removes it. Each user has one reaction per item.',
    alternativeQuestions: [
      'Can I remove my like?',
      'How do I dislike a comment?',
    ],
    keywords: ['like dislike', 'reaction', 'remove like'],
  },
];
const categories = [
  { name: 'Account', slug: 'account' },
  { name: 'Blog Management', slug: 'blog-management' },
  { name: 'Categories and Tags', slug: 'categories-and-tags' },
  { name: 'Search and Navigation', slug: 'search-and-navigation' },
  { name: 'General Support', slug: 'general-support' },
];
const seedId = (key: string) => {
  const hex = createHash('sha256')
    .update(`bloghub-faq-v1:${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export async function seedFaqs(manager: EntityManager) {
  const categoryIds = new Map<string, string>();
  for (const category of categories) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(FaqCategoryEntity)
      .values({ id: seedId(category.slug), ...category })
      .orIgnore()
      .execute();
    const existing = await manager.findOne(FaqCategoryEntity, {
      where: [
        { id: seedId(category.slug) },
        { slug: category.slug },
        { name: category.name },
      ],
    });
    if (!existing) throw new Error('FAQ category could not be resolved');
    categoryIds.set(category.slug, existing.id);
  }
  for (const { key, category, ...faq } of initialFaqs) {
    if (await manager.existsBy(FaqEntity, { question: faq.question })) continue;
    await manager
      .createQueryBuilder()
      .insert()
      .into(FaqEntity)
      .values({
        id: seedId(key),
        ...faq,
        categoryId: categoryIds.get(category)!,
        displayOrder: initialFaqs.findIndex((item) => item.key === key),
      })
      .orIgnore()
      .execute();
  }
}

async function main() {
  const database = new DataSource({
    ...migrationSource.options,
    entities: [FaqEntity, FaqCategoryEntity],
    migrations: [],
    synchronize: false,
  });
  try {
    await database.initialize();
    await database.transaction(seedFaqs);
    console.log(
      'FAQ seed complete. Existing answers and activation settings were preserved.',
    );
  } catch {
    console.error(
      'FAQ seed failed. Check the database connection and run migrations first.',
    );
    process.exitCode = 1;
  } finally {
    if (database.isInitialized) await database.destroy();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
