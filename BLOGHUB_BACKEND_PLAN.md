# BlogHub backend plan

Status: implementation started module by module. Users and Auth are implemented. Categories and Tags now provide public reads, author/admin creation, owner-or-admin editing, and admin-only deletion. Tags now belong to a required category, tag-name uniqueness is scoped to the category, admin category deletion cascades to its child tags, and category/tag slugs regenerate on rename. Blogs CRUD, drafts/publishing, ownership/admin moderation, pagination, and public search/category/tag/author filters are implemented. General database migrations are pending. Self-service profile editing and password changes are implemented; forgot-password/reset uses an emailed verification code. Admin user listing, detail, and author enable/disable management are implemented; see `docs/USER_MANAGEMENT.md`. See `docs/AUTH.md`, `docs/TAXONOMY.md`, and `docs/BLOGS.md` for configuration and API use.

## Goal and agreed scope

Build the core BlogHub backend using the existing NestJS, TypeScript, PostgreSQL, and TypeORM repository. Work through milestones at a steady pace; the original October 16 deadline no longer applies.

Visitors can read published blogs and shared categories/tags. Registered authors can manage their own blogs and drafts, create categories/tags, and edit only categories/tags they created. Admins can view/delete all blogs for moderation, edit only their own blogs, and edit/delete any category/tag. Authors cannot delete categories/tags. Taxonomy creation and editing need no approval.

V1 includes email/password authentication with refresh sessions, blog CRUD, taxonomy, search/filter/pagination, migrations, tests, local setup, and API documentation. Keep `POST /auth/refresh` and per-session logout. Do not implement `POST /auth/logout-all`.

Deployment, comments, likes, registration email verification, account deletion, admin role changes, and admin profile/password overrides are outside v1.

## Milestone 1: Backend foundation

- Preserve existing uncommitted changes and build on the current scaffold.
- Organize Auth, Users, Blogs, Categories, and Tags modules with shared guards and configuration.
- Use `/api/v1` for application endpoints and `/api/docs` for Swagger documentation. Paths below are relative to `/api/v1`.
- Centralize environment configuration, validate required values at startup, and read `DB_PORT` from configuration.
- Keep ESM and `.js` import conventions. Use Node.js 24.11 or later within the Node 24 release line.
- Configure DTO validation, consistent HTTP errors, an explicit frontend CORS allowlist, Helmet, and authentication rate limits.
- Add local PostgreSQL Docker Compose setup and a secret-free `.env.example`.
- Replace schema synchronization with explicit TypeORM migrations and shared CLI/application database configuration. Inspect the existing database before applying the initial migration; preserve existing data.
- Provide a database health endpoint.

Acceptance: a fresh local setup can start PostgreSQL, apply migrations, start the API, and pass the database health check.

## Milestone 2: Schema and authentication

### Database model

Use UUID primary keys and timestamps.

| Table              | Main fields and relationships                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `users`            | Unique normalized email, display name, password hash, author/admin role, active/disabled status                                                         |
| `refresh_sessions` | User, session identifier, expiry, revocation state                                                                              |
| `refresh_tokens`   | Session, unique token hash, creation time, rotation/use timestamp; retained for reuse detection                                 |
| `blogs`            | Author, category, title, unique slug, Markdown content, optional cover URL, draft/published status, first publication timestamp |
| `categories`       | Display name, unique normalized name and slug, creator ID, timestamps                                                           |
| `tags`             | Parent category ID, display name, normalized name unique within the category, globally unique slug, creator ID, timestamps      |
| `blog_tags`        | Blog/tag relationship with a unique pair                                                                                        |

- New blogs require one category and support up to 10 tags belonging to it. After category deletion, the blog category is null and displayed as Uncategorized; the post owner can reassign it.
- Index published listing order, author/category filters, tag relationships, and session lookup.
- Public registration creates an author only. Provision the first admin through an explicit local command; registration cannot choose a role.
- Implemented command: `npm run seed:admin`, configured through `ADMIN_EMAIL`, `ADMIN_DISPLAY_NAME`, and `ADMIN_PASSWORD` in local `.env`. It hashes passwords, preserves existing admins, and rejects author email conflicts rather than silently promoting them. See `docs/ADMIN.md`.

### Authentication endpoints

| Method | Path             | Behavior                                                                             |
| ------ | ---------------- | ------------------------------------------------------------------------------------ |
| POST   | `/auth/register` | Create an author account                                                             |
| POST   | `/auth/login`    | Verify credentials, create a session, return an access token, set the refresh cookie |
| POST   | `/auth/refresh`  | Rotate a valid refresh token and return a new access token                           |
| POST   | `/auth/logout`   | Revoke the current session and clear its refresh cookie                              |
| GET    | `/auth/me`       | Return the authenticated user's safe account fields                                  |

- Hash passwords with bcrypt. Normalize email before uniqueness checks.
- `PATCH /auth/me` edits the signed-in account display name/email; email changes require the current password. `POST /auth/change-password` verifies the current password and revokes all of that user's sessions after changing it. See `docs/ACCOUNT.md`. Forgot-password/reset requires a six-digit email code; see `docs/FORGOT_PASSWORD.md`.
- Use one-hour JWT access tokens through `Authorization: Bearer` and opaque refresh tokens with a seven-day absolute session lifetime.
- Store only refresh-token hashes. The `refresh_sessions` table supports renewal, rotation/reuse detection, and current-session logout; it remains necessary without logout-all.
- Rotate refresh tokens atomically. Retain enough information to identify reuse of a replaced token and revoke its session. The frontend must serialize refresh requests to avoid concurrent rotation.
- Set the refresh token in an HttpOnly cookie scoped to `/api/v1/auth`, with `SameSite=Lax` locally and `Secure` over HTTPS. Validate frontend origins on cookie-authenticated mutation requests.
- The frontend keeps access tokens in memory and calls refresh on reload or access-token expiry. It clears its access token on logout.
- Include the session ID in access tokens. Authentication guards verify the session is active and the user's current role, so logout and reuse detection also invalidate access tokens for that session.
- Logout is idempotent. Clear the cookie even if the session has already expired or been revoked.
- Never return password hashes or refresh tokens in JSON responses or write them to logs. Do not add a logout-all endpoint.

Acceptance: registration, login, refresh rotation, expiry, reuse detection, per-session logout, and role enforcement work with PostgreSQL. Logging out one session leaves other sessions active.

## Milestone 3: Blogs and taxonomy

### Blog endpoints

| Method | Path               | Access and behavior                                   |
| ------ | ------------------ | ----------------------------------------------------- |
| GET    | `/blogs`           | Public published-blog listing                         |
| GET    | `/blogs/:slug`     | Public published-blog detail                          |
| GET    | `/me/blogs`        | Author's own blogs, including drafts                  |
| GET    | `/me/blogs/:id`    | Owned blog detail for editing                         |
| POST   | `/blogs`           | Author/admin creates a blog owned by the current user |
| PATCH  | `/blogs/:id`       | Owner only edits/publishes a blog                     |
| DELETE | `/blogs/:id`       | Owner or admin permanently deletes a blog             |
| GET    | `/admin/blogs`     | Admin lists all blogs, including drafts               |
| GET    | `/admin/blogs/:id` | Admin reads any blog for moderation                   |

- New blogs default to draft. Authors can publish or return their blogs to draft. Public queries never expose drafts.
- Generate a unique slug from the title on creation, with a suffix for collisions. Keep it stable after title changes.
- Record the first publication time and preserve it through edits and republishing.
- Store Markdown without rendering it. The frontend must sanitize rendered Markdown. Accept HTTP(S) external cover URLs without fetching them, or one multipart JPEG/PNG/WebP image up to 5 MB. Multer receives the image, which is stored under `src/asset/images`; persist its server-generated `/images/<filename>` URL in `cover_image_url`. See `docs/IMAGES.md`.
- Validate category/tag references and save blog changes plus tag relationships in one transaction.
- Return public author ID and display name only; keep email private.

### Taxonomy endpoints

- Public `GET /categories`, `GET /categories/:slug`, `GET /tags`, and `GET /tags/:slug`.
- Author/admin `POST /categories` and `POST /tags`; ownership comes from the authenticated account.
- Author/admin `PATCH /categories/:id` and `PATCH /tags/:id`; authors can edit only their own entries, while admins can edit any entry.
- Admin-only `DELETE /categories/:id` and `DELETE /tags/:id`; authors cannot delete, including their own entries.
- Creation/editing take effect immediately without approval. Category creation/update and tag update accept only `name` (1–100 characters after normalization). Tag creation also requires an existing `categoryId`; parent category remains fixed after creation.
- Reject duplicate names with 409 regardless of capitalization, surrounding whitespace, or repeated internal whitespace. Category names are globally unique; tag names are unique within their parent category. Enforce both rules in PostgreSQL.
- Generate globally unique slugs on creation and regenerate them on rename, retrying collisions with a UUID suffix. Old detail URLs stop working after the slug changes.
- Return public ID, name, slug, creator ID, and timestamps; keep normalized names and user credentials private. Lists sort by normalized name then ID; read details by slug and mutate by UUID. Include categoryId in tag responses and support public GET /tags?categoryId=<uuid>.
- Admin deletion of a category cascades to all child tags through PostgreSQL ON DELETE CASCADE, regardless of tag creator; unrelated categories/tags remain intact. Existing unassigned tags are deleted as explicitly requested when adding the required category relation; categories/users are retained.
- Category deletion preserves blogs through `ON DELETE SET NULL`; responses show `categoryId: null`, `category: null`, and `categoryName: "Uncategorized"`. Deleted tags cascade only to `blog_tags` links, preserving posts. New posts still require a category.

### Search, filtering, and pagination

- Implemented: `GET /blogs` accepts `q`, exact `category` slug, exact `tag` slug, partial author display name via `author`, `page`, and `limit`. Own/admin lists retain pagination and optional `status` filtering.
- Combine filters with AND semantics. Use parameterized, case-insensitive PostgreSQL partial title/content and author display-name matching. Trim filter inputs and reject blank values. Escape LIKE wildcards to search literal text. Return posts from all matching authors if names overlap.
- Default to page 1 and limit 10; reject nonpositive values or limits above 50.
- Order published listings by publication time descending, then ID as a stable tie-breaker. Own/admin listings use creation time descending, then ID, and support optional draft/published status filtering.
- Return `{ items, page, limit, total, totalPages }`. Out-of-range pages return empty items; empty results have zero total pages.
- List responses include an excerpt and metadata; detail responses include full Markdown. Use the first 200 Unicode characters of stored content for the excerpt; it remains Markdown text.
- Use consistent `400`, `401`, `403`, `404`, and `409` errors. Public requests for unpublished posts return `404`.

Acceptance: the frontend can browse/search published blogs, create/edit/publish drafts, and manage taxonomy as an admin through documented endpoints.

## Milestone 4: Verification and integration documentation

- Add focused unit tests for authorization, session rotation, publishing rules, and slug generation.
- Run integration/e2e tests against a separate PostgreSQL test database with migrations applied. Never run destructive tests against the development database.
- Cover duplicate registration, invalid login, expired/reused refresh tokens, concurrent rotation, idempotent logout, and isolation between login sessions.
- Cover unauthorized mutations, cross-author access, admin moderation, and draft privacy.
- Cover category deletion preserving blogs, atomic tag updates, slug collisions, combined filters, pagination boundaries, and invalid input.
- Verify migrations against an empty database and confirm operation with `synchronize: false`.
- Run build, lint, unit tests, and relevant e2e tests before completing each milestone.
- Document setup, environment variables, migrations, admin provisioning, test commands, authentication/cookie behavior, and API examples.
- Keep Swagger request/response schemas and authentication requirements current as endpoints are added.

Acceptance: a fresh checkout can be set up from the README, checks pass, and the Next.js developer can integrate using Swagger and documented examples.

## Implementation defaults

- Deliver local development and frontend integration first; plan hosting separately.
- Assume compatible same-site frontend/backend domains for refresh cookies. Revisit cookie settings when hosting is selected.
- Validation: titles up to 200 characters, Markdown up to 100,000 characters, up to 10 distinct tags per blog, passwords at least 8 characters and at most 72 UTF-8 bytes.
- Keep suitable installed dependencies. Add only packages needed for JWTs, DTO validation, Swagger, and rate limiting.
- Retain PostgreSQL-backed refresh sessions; no Redis or background worker is required for v1.
- Implement one milestone at a time, keeping API documentation and tests alongside each feature.
