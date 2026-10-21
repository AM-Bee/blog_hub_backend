# In-app notifications

Authors receive an in-app notification when an admin unpublishes/blocks or deletes their post. This feature uses one `notifications` table and a small Notifications module following the existing controller/service/repository structure.

## When notifications are created

| Action                                                          | Notification         |
| --------------------------------------------------------------- | -------------------- |
| Admin unpublishes another user's published post                 | `post_unpublished`   |
| Admin first blocks another user's existing draft                | `post_unpublished`   |
| Admin repeats the same blocked-draft status                     | None                 |
| Admin publishes a post                                          | None in this version |
| Admin deletes another user's post                               | `post_deleted`       |
| Author edits, publishes, unpublishes, or deletes their own post | None                 |
| Admin moderates/deletes their own post                          | None                 |
| Invalid, forbidden, or rolled-back action                       | None                 |

If an admin publishes a previously blocked post and later unpublishes it again, that is a new moderation action and creates a new notification. The notification goes to the post owner; this also works if that owner is another admin.

Example messages:

> An admin unpublished your post "Ballet Guide". You can edit it, but only an admin can publish it again.

> An admin deleted your post "Ballet Guide".

The existing Blogs repository inserts the notification using the same transaction manager as the post change and audit record. If any of these writes fails, all roll back. There is no email, queue, background worker, event system, WebSocket, or frontend implementation in this change.

## Protected endpoints

Use `Authorization: Bearer <BlogHub-access-token>` on every request. No Origin header is required. Every query/update uses the signed-in user's ID from the token; there is no client-selected recipient. Admins also see only notifications addressed to themselves.

### List notifications

```text
GET http://localhost:5300/api/v1/me/notifications?page=1&limit=10
```

`page` defaults to 1 and must be an integer from 1 to 1,000,000. `limit` defaults to 10 and must be an integer from 1 to 50. Results include read and unread notifications, newest first, then ID descending for ties. Additional query fields such as `userId` are rejected with 400.

HTTP 200 example:

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "550e8400-e29b-41d4-a716-446655440001",
      "type": "post_deleted",
      "blogId": "550e8400-e29b-41d4-a716-446655440002",
      "blogTitle": "Ballet Guide",
      "message": "An admin deleted your post \"Ballet Guide\".",
      "readAt": null,
      "createdAt": "2026-10-21T08:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1,
  "unreadCount": 1
}
```

`readAt: null` means unread. `unreadCount` counts all of this user's unread notifications across every page, not just the current page. Empty results have `totalPages: 0`. Pages beyond the last page have empty `items` but retain the totals and unread count. Counts can change between polling requests as notifications arrive or are read.

### Mark one as read

```text
PATCH http://localhost:5300/api/v1/me/notifications/<notification-uuid>/read
```

No request body is needed. Use the notification's `id`, not its blog ID. HTTP 200 returns that notification with `readAt` set to an ISO timestamp.

Repeating the request succeeds and preserves the first read timestamp. An unknown notification, or one addressed to another user, returns 404 and is not modified. A malformed UUID returns 400.

### Mark all as read

```text
PATCH http://localhost:5300/api/v1/me/notifications/read-all
```

No request body is needed. This updates only the signed-in user's unread notifications and preserves timestamps on notifications already read.

HTTP 200 example:

```json
{
  "message": "All notifications marked as read",
  "updated": 3
}
```

`updated` is the number newly marked as read. Repeating the request with no new unread notifications returns `updated: 0`. A notification arriving after this update remains unread.

All three endpoints return 401 for missing, invalid, expired, revoked, or disabled-account authentication. There are no notification creation, deletion, or admin-wide management endpoints.

## Storage and deletion behavior

The table stores `id`, `user_id`, `type`, `blog_id`, `blog_title`, `message`, nullable `read_at`, and `created_at`.

- The recipient references `users` with ON DELETE CASCADE. Account deletion is outside the current API scope.
- `blog_id` is a historical UUID without a blog foreign key, so deleting the post preserves its notification and saved title.
- Notifications contain a title and moderation message, not full content, password fields, user emails, or tokens.
- Existing notifications are not rewritten if a post is later renamed or republished. They describe the action at the time it happened.
- Read notifications remain available. No notification purge/retention job is added.

Audit history remains separate: the moderation audit record belongs to the admin who acted, while the notification belongs to the author receiving it. Authors do not gain access to the admin's audit history.

## Setup

With the current development `synchronize: true` configuration, restart the backend:

```bash
npm run start
```

TypeORM creates the new table from its entity. For an existing environment with synchronization disabled, the optional incremental migration is registered with the existing command:

```bash
npm run migration:run
```

The migration has not been applied to your application database by this implementation. Reverting it drops the notifications table and its stored notifications. Demo seeding does not generate fake notifications. Only future moderation/deletion actions generate notifications; there is no historical backfill.

## Postman testing

1. Log in as an author and create a post. Save its ID and title.
2. Log in as admin. PATCH `/api/v1/admin/blogs/<blog-id>/status` with `{"status":"draft"}`.
3. With the author's token, GET `/api/v1/me/notifications`. Expect `post_unpublished`, the saved title, `readAt: null`, and an increased unread count.
4. Repeat the same admin draft request. It should not add another notification.
5. Copy the notification ID and PATCH `/api/v1/me/notifications/<notification-id>/read` with the author's token. GET the list again; the unread count should decrease.
6. Delete the post as admin. GET the author's list again; the `post_deleted` notification should remain available even though the blog is gone.
7. PATCH `/api/v1/me/notifications/read-all` with the author's token. Check `updated` and then `unreadCount: 0`.
8. Try marking the author's notification as read using a different user's or admin's token. Expect 404.

Swagger documents the routes under `notifications` at `/api/docs`.

## Frontend contract for later

Use the list response for a bell dropdown and unread badge. Poll it periodically and refetch when opening the dropdown or after marking notifications as read. Render messages as text. Deleted-post notifications display the saved title without a link to a missing post; unpublished posts can open the owner's editing screen using `blogId` if the post still exists. There is no live push connection in this version.

## Changed files and checks

The new `src/notifications` folder contains its entity, type enum, DTOs, interfaces, controller, service, and repository. `src/app.module.ts` registers the module. `src/blogs/blogs.module.ts` registers the notification entity for transactional inserts. `src/blogs/blogs.repository.ts` creates notifications only for the specified admin actions. `src/database/migrations/1792570000000-AddNotifications.ts` provides the incremental schema change.

```bash
npm test
npm run lint
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/notifications/notifications.postgres.spec.ts
```

Unit tests cover recipient scoping, unread counts, marking read, and query validation. The opt-in PostgreSQL/HTTP suite uses a random temporary schema and real authentication/transactions to check notification delivery, duplicate suppression, own-action exclusions, privacy, pagination, repeatable read operations, deletion retention, concurrent unpublishing, migrations, and rollback when notification insertion or post deletion fails. The suite removes its test schema and never modifies application tables, sends email, or calls Google.
