# Blog comments and replies

Post deletion now moves the post to Trash; permanent deletion requires a Trash endpoint. See [BLOG_TRASH.md](BLOG_TRASH.md) for restoration, permissions, preserved relationships, and storage limits.

Administrative access now requires explicit permissions; the main admin has all administrative permissions. See [ADMIN_PERMISSIONS.md](ADMIN_PERMISSIONS.md) for the current permission matrix and rollout. Owner restrictions still apply.

Comments use the existing NestJS authentication and PostgreSQL connection. There
is no new authentication system, Supabase client, environment variable, or package.
The frontend calls NestJS, never the Supabase table directly.

## Deploy to your existing Supabase project

1. From the backend folder, confirm your private `.env` still points to the correct
   Supabase database (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`,
   `DB_SSL=true`, `DB_SSL_CA_FILE=certs/supabase-ca.crt`). Do not paste secrets.
2. Run:

   ```bash
   npm run migration:run
   ```

   This compiles the backend and runs pending migrations, including
   `AddBlogComments1793577600000`. It adds `blog_comments` and its indexes/foreign
   keys. Existing users and posts are preserved. Startup alone does not migrate.
   If other migrations are pending, the command runs those too. Re-running the
   command skips recorded migrations.

3. In Supabase, refresh **Table Editor → public → blog_comments**. Do not create the
   table manually. Keep the backend-only Data API setup described in SUPABASE.md.
4. Restart your local backend (`npm run start:dev`) to test. Commit and push the
   backend changes, then wait for Render's deployment. If Auto-Deploy is disabled,
   use Render's manual deployment. Run the migration before deploying the new API.
5. The frontend developer can then build the UI using the endpoints below. The
   backend change alone does not display comments on the website.

## Table and files

`blog_comments` contains `id`, `blog_id`, `user_id`, nullable `parent_id`, `content`,
`created_at`, and `updated_at`. A null parent means a top-level comment. A non-null
parent points to a top-level comment on the same blog. NestJS rejects replies to
replies and does not accept `userId`, `blogId`, or `parentId` in request bodies.

- `src/comments/entities/blog-comment.entity.ts`: TypeORM table relationships.
- `src/comments/dto/comment.dto.ts`: input validation and Swagger response schemas.
- `src/comments/interfaces/comment.interface.ts`: response types.
- `src/comments/comments.controller.ts`: six routes, validation, and JWT guards.
- `src/comments/comments.service.ts`: delegates each operation to the repository.
- `src/comments/comments.repository.ts`: queries, publication checks, ownership,
  safe response mapping, and transactions. Writes lock the blog before changing
  comments so they coordinate with existing moderation and deletion operations.
- `src/comments/comments.module.ts`: connects the feature and existing auth.
- `src/database/migrations/1793577600000-AddBlogComments.ts`: creates the table.
- `src/app.module.ts`: registers CommentsModule. TypeORM auto-loads its entity.
- `src/database/data-source.ts`: registers the new migration.

## Rules

- All six routes operate only on **published** posts. Draft/missing posts return
  404, including for their authors and admins. Unpublishing hides comments without
  deleting them; publishing again makes them available.
- Reading is public. Creating, replying, editing, and deleting require the existing
  `Authorization: Bearer <accessToken>` header. Disabled users/expired sessions are
  rejected by the existing auth guard.
- Anyone logged in may comment or reply. Only the writer can edit; admins cannot
  rewrite another user's words. Writers can delete their own items; admins can
  delete any item. Owning the blog does not grant deletion rights over others'
  comments.
- Content is trimmed, plain text, 1–2000 characters. The frontend must render it as
  text, never inject it as HTML. Unknown body fields are rejected.
- Deleting a top-level comment **permanently deletes all its replies**, including
  replies by other users. Deleting a reply affects only that reply. Deleting a blog
  cascades to all its comments. Deleting a user also removes their comments and
  any replies under those comments. No soft deletion or undo is provided.
- Likes/dislikes and reply totals are documented in [REACTIONS.md](REACTIONS.md).
- No notifications, real-time events, or comment-specific anti-spam controls are added.

## Endpoints (prefix `/api/v1`)

| Method | Path                      | Result                            |
| ------ | ------------------------- | --------------------------------- |
| GET    | `/blogs/:blogId/comments` | 200, paginated top-level comments |
| POST   | `/blogs/:blogId/comments` | 201, new top-level comment        |
| GET    | `/comments/:id/replies`   | 200, paginated direct replies     |
| POST   | `/comments/:id/replies`   | 201, new direct reply             |
| PATCH  | `/comments/:id`           | 200, edited comment or reply      |
| DELETE | `/comments/:id`           | 204, empty response               |

Use the blog's UUID `id`, not its slug. Both GET routes accept `page` (default 1)
and `limit` (default 10, maximum 50). Ordering is oldest first, with ID breaking
timestamp ties. The parent list excludes replies; fetch each thread separately.
GET replies requires a top-level comment ID; a reply ID returns 400.

POST and PATCH bodies:

```json
{ "content": "My comment or reply" }
```

A returned item contains `id`, `blogId`, `parentId`,
`author: { id, displayName }`, `content`, `replyCount`, `likeCount`, `dislikeCount`,
`createdAt`, and `updatedAt`. Replies always have `replyCount: 0`.
No email, password, or session fields are exposed. A page contains `items`, `page`,
`limit`, `total`, and `totalPages`. `total` counts only the requested level.

## Test step by step in Postman

Set `baseUrl` to `http://localhost:5300/api/v1` locally or
`https://blog-hub-backend-cnzm.onrender.com/api/v1` after deployment.

1. Log in through the existing auth endpoint and use its access token.
2. From an existing published blog response, copy its `id` as `blogId`.
3. POST `{{baseUrl}}/blogs/{{blogId}}/comments`, Bearer token, raw JSON body
   `{"content":"My first comment"}`. Expect 201; save its `id` as `commentId`.
4. GET `{{baseUrl}}/blogs/{{blogId}}/comments?page=1&limit=10` with No Auth.
   Expect 200 and your comment in `items`.
5. POST `{{baseUrl}}/comments/{{commentId}}/replies` with a token and
   `{"content":"My reply"}`. Expect 201; save its ID as `replyId`.
6. GET `{{baseUrl}}/comments/{{commentId}}/replies` with No Auth. Expect 200.
7. PATCH `{{baseUrl}}/comments/{{replyId}}` as its writer with
   `{"content":"Edited reply"}`. Expect 200.
8. Try replying to `replyId`: expect 400. Try editing as a different user:
   expect 403. Try posting without a token: expect 401.
9. DELETE `{{baseUrl}}/comments/{{commentId}}` as its writer or an admin.
   Expect 204. Both the parent and its replies are gone.

Tests use disposable schemas rather than live application tables:

```bash
npm test
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e -- --testNamePattern 'supports published comments'
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/database/migrations/initial-schema.spec.ts
```

The migration's `down` drops the entire comments table and its data. Do not roll it
back to undo an individual comment. Normal `migration:run` does not run `down`.
