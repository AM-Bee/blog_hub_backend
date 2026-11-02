# Likes, dislikes, and reply counts

The backend now supports one reaction per signed-in user on each published blog,
comment, or reply. All existing JWT/session/account checks are reused. No new
packages or environment variables are required.

## Supabase and Render

From the backend folder with your existing Supabase `.env`, run:

```bash
npm run migration:run
```

The new `AddReactions1793577700000` migration creates `reactions`. If the comments
migration is still pending it runs first. The command does not delete existing
users, blogs, or comments. Table Editor will show the new table after refresh.
`replyCount` and reaction totals are calculated from rows; they are not database
columns and do not require backfilling existing comments.

After migration, restart locally (`npm run start:dev`). Commit and push, then wait
for Render to show the new deployment as Live. If automatic deployment is off,
choose **Manual Deploy → Deploy latest commit**. Startup alone does not migrate.
The frontend still calls NestJS, never the Supabase table directly.

## API (prefix `/api/v1`)

| Method | Path                      | Authentication        | Behavior                               |
| ------ | ------------------------- | --------------------- | -------------------------------------- |
| GET    | `/blogs/:id/reactions`    | Optional Bearer token | Blog counts and your reaction          |
| POST   | `/blogs/:id/reactions`    | Required Bearer token | Toggle your blog reaction              |
| GET    | `/comments/:id/reactions` | Optional Bearer token | Comment/reply counts and your reaction |
| POST   | `/comments/:id/reactions` | Required Bearer token | Toggle your comment/reply reaction     |

IDs are UUIDs. For blogs, use the blog's `id`, not its slug. A reply uses exactly the
same reactions routes as a comment, with the reply's ID.

POST body (only `type` is accepted):

```json
{ "type": "like" }
```

Use `"dislike"` for a dislike. Each POST returns HTTP 200:

```json
{
  "likeCount": 3,
  "dislikeCount": 1,
  "myReaction": "like"
}
```

Both GET routes return the same shape. Without a token, `myReaction` is always
`null`; with a valid token it is `"like"`, `"dislike"`, or `null`. The API never
returns other users' identities or individual reaction histories. A supplied
invalid/expired token returns 401 rather than silently treating the user as a
visitor. Personalized GET responses must not be put in a shared frontend cache.

### Toggle behavior

- No existing reaction → create the requested reaction.
- Existing opposite reaction → replace it.
- Existing same reaction → remove it and return `myReaction: null`.
- Switching never leaves both a like and a dislike for the same user/item.

This is deliberately POST, because sending it twice is **not idempotent**. The
frontend should disable buttons while submitting and should not automatically
retry a timed-out toggle: fetch the current summary first. There is no separate
DELETE endpoint; toggling the selected reaction removes it.

Anyone signed in, including the item's author, may react. No one can set another
user's reaction or react to an unpublished/missing blog or its comments. Drafts
return 404 even for an admin. Unpublishing hides the reactions without deleting
them; republishing restores access. Disabled accounts and revoked/expired sessions
are rejected by existing authentication. Counts are public only while the post is
published.

## Comment reply and reaction totals

The existing comment list, reply list, create, and edit responses now include:

```json
{
  "replyCount": 2,
  "likeCount": 3,
  "dislikeCount": 1
}
```

`replyCount` is the total direct replies, independent of reply pagination. Replies
have `replyCount: 0` because only one level is supported. New comments/replies start
with all three counts zero. Editing a comment preserves and returns its current
counts. Deleting a reply reduces its parent's count on the next fetch.

The existing blog responses remain unchanged. Fetch `/blogs/:id/reactions` for
blog totals. Comment responses include totals but not personalized reaction state;
fetch `/comments/:id/reactions` with the current user's token for that state.
After toggling, use the returned summary to update the buttons and counts. After
creating/deleting a reply, refresh the parent comment list to update `replyCount`.
No real-time reaction events are added.

## Database and files

One `reactions` row contains:

- `id`: UUID primary key.
- `user_id`: reacting user.
- `blog_id` OR `comment_id`: exactly one target, enforced by a CHECK constraint.
- `type`: `like` or `dislike`, enforced by a CHECK constraint.

Unique indexes on `(blog_id, user_id)` and `(comment_id, user_id)` prevent duplicate
votes. Foreign keys delete reactions automatically when their blog, comment,
reply, or user is deleted. Deleting a parent comment also removes reactions on its
cascaded replies. No existing deletion semantics change.

- `src/reactions/entities/reaction.entity.ts`: table, foreign keys, unique indexes,
  and CHECK constraints.
- `src/reactions/enums/reaction-type.enum.ts`: two allowed reaction values.
- `src/reactions/dto/reaction.dto.ts`: validated input and Swagger output.
- `src/reactions/interfaces/reaction.interface.ts`: summary response type.
- `src/reactions/reactions.controller.ts`: four routes and auth guards.
- `src/reactions/reactions.service.ts`: delegates operations.
- `src/reactions/reactions.repository.ts`: publication checks, toggles, aggregate
  counts, and transactions. Writes lock the blog, matching comment writes,
  moderation, and deletion. A comment is rechecked after acquiring that lock.
- `src/reactions/reactions.module.ts`: feature registration, imported by CommentsModule.
- `src/auth/guards/optional-jwt-auth.guard.ts`: permits anonymous reads while
  verifying any supplied token through the existing JWT guard.
- `src/comments/comments.repository.ts`: adds grouped reply/reaction totals to a
  page of comments, avoiding a separate database query for every comment.
- `src/database/migrations/1793577700000-AddReactions.ts`: creates the table.
- `src/database/data-source.ts`: registers the migration after comments.

## Postman checks

Use `http://localhost:5300/api/v1` locally or
`https://blog-hub-backend-cnzm.onrender.com/api/v1` after deployment.

1. GET `/blogs/<published-blog-id>/reactions`, No Auth: expect counts and
   `myReaction: null`.
2. Log in, then POST the same URL with Bearer token and `{"type":"like"}`:
   expect one additional like and `myReaction: "like"`.
3. POST `{"type":"dislike"}`: the like is replaced with a dislike.
4. POST `{"type":"dislike"}` again: the dislike is removed.
5. Repeat with `/comments/<comment-id>/reactions`, then with a reply ID.
6. Fetch the comment list: check `replyCount`, `likeCount`, and `dislikeCount`.
7. Create/delete a reply, refresh the comment list, and confirm its `replyCount` changes.
8. POST without a token: expect 401. Send `{"type":"love"}` or extra `userId`:
   expect 400. Unpublish the blog: both GET and POST should return 404.

## Verification

```bash
npm test
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e -- --testNamePattern 'counts replies and toggles'
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/database/migrations/initial-schema.spec.ts
```

Database tests use disposable schemas, not application tables. They cover blog,
comment, and reply reactions; switching/removal; anonymous and personalized reads;
reply totals; permission/validation errors; concurrent toggles; database constraints;
unpublishing; and cascading cleanup. Migration tests compare the entire migrated
schema to entity definitions and check rerunning migrations preserves data.

Rolling back this migration drops all saved reactions. Normal `migration:run`
does not roll it back. No frontend, notifications, or reaction anti-spam controls
are implemented here.
