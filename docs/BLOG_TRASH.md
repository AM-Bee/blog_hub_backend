# Blog Trash

Deleting a post now moves it to Trash. Its existing `blogs` row is retained with `deletedAt` and `deletedById`; there is no duplicate trash table. TypeORM's `DeleteDateColumn` excludes trashed posts from normal blog queries, admin user blog counts, public search, and mobile snapshots.

## Endpoints

Paths start with `/api/v1`. All require the existing bearer access token.

| Method and path | Access | Result |
| --- | --- | --- |
| `DELETE /blogs/:id` | Owner, or `blogs.delete` for another author's post | 204; move to Trash. Existing optional `?version=N` still applies. |
| `GET /me/blog-trash` | Owner's posts only | Paginated summaries |
| `GET /me/blog-trash/:id` | Owner's post only | Full trashed post |
| `POST /me/blog-trash/:id/restore` | Owner, if the owner trashed it | 200; restored draft |
| `DELETE /me/blog-trash/:id` | Owner | 204; permanently delete from Trash |
| `GET /admin/blog-trash` | `blogs.moderate` | Paginated summaries of all trashed posts |
| `GET /admin/blog-trash/:id` | `blogs.moderate` | Full trashed post |
| `POST /admin/blog-trash/:id/restore` | `blogs.restore` | 200; restore any trashed post as a draft |
| `DELETE /admin/blog-trash/:id` | `blogs.purge` | 204; permanently delete a trashed post |

Admin routes also require an admin role. Main admins automatically receive both new permissions. Existing regular admins do **not** gain restore/purge privileges from `blogs.delete`; explicitly grant `blogs.restore` and/or `blogs.purge` if intended. Owners keep their own Trash rights without administrative grants.

Lists support `?page=1&limit=10` (maximum limit 50), ordered by deletion time descending then ID descending. List items contain the normal blog summary fields plus:

```json
{
  "deletedAt": "2026-11-04T08:00:00.000Z",
  "deletedById": "actor-user-uuid",
  "canRestore": true,
  "canPermanentlyDelete": true
}
```

Detail responses include full Markdown content. Capability flags describe the current viewer's access through that route. Owner routes return 404 for another author's post. Missing posts, active posts on Trash routes, and trashed posts on ordinary blog routes return 404. Missing administrative grants and attempting owner restoration of an admin-trashed post return 403. Restore needs no JSON body. Permanent deletion is available only after moving a post to Trash.

## What survives Trash and restoration

- The ID, slug, title, content, cover URL, category, tags, comments, replies, and reactions remain stored.
- Trashed posts cannot be read through normal public/owner/admin post routes, edited, published, commented on, replied to, or reacted to. Existing comment/reaction endpoints return 404 while their post is in Trash.
- Restoration sets `status=draft`, clears `publishedAt`, and clears the deletion fields. It does not publish the post automatically.
- Existing `publicationBlocked` moderation flags remain intact. An author cannot clear an admin publishing block by trashing and restoring a post.
- An author cannot restore a post trashed by someone else, even if later promoted. An authorized admin must use the admin restore route. The author may still permanently delete their own admin-trashed post.
- If categories/tags are separately deleted while a post is in Trash, existing foreign-key rules apply. Restoration does not recreate deleted taxonomy.
- Slugs and IDs remain reserved while a post is in Trash.
- There is no automatic expiration or scheduled deletion.

## Permanent deletion and history

Purge physically deletes the blog row. Existing foreign keys cascade to its tag links, comments, replies, and reactions. It cannot subsequently be restored through this API.

Audit history and historical sync receipts remain, as before; purge does not erase historical JSON snapshots. New audit actions are `trashed`, `restored`, and `permanently_deleted`; legacy `deleted` records are still valid. Lifecycle actions save a content snapshot, and actions/notifications are committed in the same database transaction as the post change. Failures roll back the entire database operation.

Admin Trash actions retain the existing `post_deleted` notification type for compatibility, with a message explaining the post moved to Trash. Admin restoration and purge use `post_restored` and `post_permanently_deleted`. Self-actions do not generate notifications.

**Storage limit:** moving/restoring/purging posts does not delete image objects. Cover URLs can be external or shared by other posts, so automatic storage cleanup is deferred until reference-aware image ownership is available. Purge removes the database post and related rows, while uploaded files remain in Storage.

## Mobile sync

- Existing `DELETE` sync operations now move active owned posts to Trash and still return `{ "deleted": true, "id": "..." }`.
- Full `/me/blog-sync` snapshots exclude Trash. Clients reconcile the completed snapshot to remove missing local posts; retain the existing complete-snapshot reconciliation logic, not a single-page comparison.
- Restored drafts reappear with the same ID and a newer version. Stale offline edits/deletes against a restored active post return 409.
- Creating an existing trashed ID returns 409. Updating a trashed ID returns 404.
- Repeated deletes of an already trashed owned post acknowledge deletion without changing its trash actor, so sync cannot bypass admin restoration restrictions.
- Existing operation receipts remain historical acknowledgements. Replaying an old receipt does not undo a later Trash/restore action; fetch a current full snapshot to reconcile state.
- Restore/purge use the new REST endpoints; no new offline mutation types were added.

## Setup and rollout

1. Back up the intended database.
2. Apply `npm run migration:run` from the backend folder with that database's environment configured.
3. Restart/redeploy the backend and update clients to distinguish Trash from permanent deletion.
4. Grant the new admin permissions where appropriate. The existing main-admin bootstrap does not need to be repeated.

Migration `1793836800000-AddBlogTrash.ts` adds nullable `deleted_at` and `deleted_by_id` columns and an index. Existing posts remain active. Startup does not run migrations automatically. Previously hard-deleted posts cannot be recovered by this migration. Rollback refuses to remove these fields while posts remain in Trash, preventing their accidental republication.

## Files to study

- `src/blogs/entities/blog.entity.ts`: soft-delete columns and index.
- `src/blogs/blog-trash.controller.ts`: the eight Trash routes and guards.
- `src/blogs/blogs.service.ts`: thin delegates to the repository.
- `src/blogs/blogs.repository.ts`: Trash queries, locked mutations, ownership, audit, notifications.
- `src/blogs/dto/blog-trash-response.dto.ts`: Swagger response shapes.
- `src/users/permissions.ts`: separate restore/purge permissions.
- `src/blogs/post-sync.service.ts`: stable ID, ownership, and retry protection for trashed posts.
- `src/seed.ts`: demo seeding recognizes trashed IDs/slugs instead of recreating them.
- `test/app.e2e-spec.ts`: lifecycle, permission, sync, and rollback acceptance cases.
