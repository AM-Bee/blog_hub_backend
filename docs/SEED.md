# Demo seed data

The seed implementation is in `src/seed.ts`. Run from the repository root:

```bash
npm run seed
```

The command compiles TypeScript and runs `dist/seed.js`. It connects using the database and SSL settings in local `.env`. Run `npm run migration:run` first to create the tables. The seed itself does not change the schema. Production mode rejects demo seeding. Demo accounts use known credentials, so do not run the demo seed on a publicly accessible deployment.

## Sample accounts

| Email                        | Display name | Role   |
| ---------------------------- | ------------ | ------ |
| `demo-admin@bloghub.example` | Demo Admin   | Admin  |
| `demo-bee@bloghub.example`   | Bee Writer   | Author |
| `demo-alan@bloghub.example`  | Alan Chen    | Author |

Their initial password is `BlogHubDemo2026!`, or the value of `SEED_PASSWORD` in `.env` when first created. Passwords are bcrypt-hashed. Changing `SEED_PASSWORD` and rerunning does not reset existing account passwords. Your existing admin account is preserved; these are separate demo accounts.

Log in through `/api/v1/auth/login` with the configured frontend Origin header as described in [AUTH.md](AUTH.md). Demo refresh-session fixtures cannot be used to log in.

## Tables populated

| Table              | Sample data                                                                          |
| ------------------ | ------------------------------------------------------------------------------------ |
| `users`            | Three demo accounts                                                                  |
| `categories`       | Dancing, Web Development, Travel, Cooking                                            |
| `tags`             | Nine category-specific tags; Beginner appears under both Dancing and Web Development |
| `blogs`            | Ten Markdown posts: eight published and two drafts, across the demo accounts         |
| `blog_tags`        | Thirteen links; every tag belongs to its post's category                             |
| `refresh_sessions` | Three expired, revoked fixtures belonging to demo users                              |
| `refresh_tokens`   | Three used token hashes associated with those expired sessions                       |

Matching existing categories/tags are reused, so newly inserted counts can be lower. Auth fixtures have no usable login session or raw refresh token. Actual login creates normal sessions through the Auth API.

## Reruns and existing data

All changes run in one transaction. Stable sample IDs prevent duplicates, including after sample records are edited or renamed. Reruns preserve existing post edits, tag links, roles, and account passwords. Missing sample records may be recreated. Existing records are never truncated or deleted.

If a demo email already belongs to an account with a different ID, the seed fails and rolls back rather than taking over that account. Category/tag slugs remain unique; a stable suffix resolves collisions. The command reports only newly inserted counts and does not print passwords or token hashes.

Try these after seeding:

```text
GET /api/v1/blogs
GET /api/v1/blogs?q=ballet&category=dancing&author=bee
GET /api/v1/blogs?category=web-development
```

Use the slug returned by the Categories API if an existing slug collision caused a suffix. Sign in as a demo author to read their drafts through `/me/blogs`, or as the demo admin to read all posts through `/admin/blogs`. See [search.md](search.md) for filters.

## Verification

The opt-in PostgreSQL suite checks seeding every table, hashed demo passwords, draft privacy, category/tag relationships, expired sessions, rerun behavior, and rollback on conflicting demo emails:

```bash
BLOGHUB_RUN_DB_TESTS=1 npm test
```

It creates and removes an isolated temporary schema, preserving application tables.

Google provider links in `auth_accounts` are not seeded. Real Google identities must be verified through the Google login/link endpoints; demo accounts remain normal password accounts.
