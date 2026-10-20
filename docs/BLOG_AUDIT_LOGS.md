# Blog audit history

Blog audit history is part of the existing Blogs module. It records successful post edits, publishing/unpublishing, admin publication blocks, and deletions in one new table: `blog_audit_logs`.

History starts when this feature is enabled. It cannot reconstruct earlier changes. Creating a post does not add an audit record in this version.

## Endpoints

Both routes require `Authorization: Bearer <accessToken>`. They work for authors and admins, and always return **only actions performed by the signed-in user**. No Origin header is required.

```text
GET http://localhost:5300/api/v1/me/blog-audit-logs
GET http://localhost:5300/api/v1/me/blog-audit-logs/<audit-log-uuid>
```

The detail URL uses the audit record ID, not the blog ID. An unknown record or a record belonging to another actor returns 404. Even admins cannot read someone else's history through these routes. Authors do not see an admin's moderation/deletion actions on their posts. There are no admin-wide history endpoints or endpoints to edit/delete audit records.

## List your actions

Optional query parameters:

| Parameter | Default | Allowed                     |
| --------- | ------- | --------------------------- |
| `page`    | 1       | Integer from 1 to 1,000,000 |
| `limit`   | 10      | Integer from 1 to 50        |

```text
GET http://localhost:5300/api/v1/me/blog-audit-logs?page=1&limit=10
```

Example response, HTTP 200:

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "blogId": "550e8400-e29b-41d4-a716-446655440001",
      "blogTitle": "Updated ballet guide",
      "actorId": "550e8400-e29b-41d4-a716-446655440002",
      "postAuthorId": "550e8400-e29b-41d4-a716-446655440002",
      "action": "updated",
      "createdAt": "2026-10-20T08:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1
}
```

The list contains summaries, ordered by creation time descending and then ID descending. Large content changes and deletion snapshots are loaded only by the detail endpoint. Empty results have zero total pages. A page beyond the end has empty items but retains the matching totals. Invalid pagination and extra query fields, including `actorId`, return 400.

`actorId` identifies who acted; `postAuthorId` identifies the post's owner at that time. They differ when an admin moderates or deletes an author's post. `blogTitle` is the title immediately after an edit, or immediately before deletion.

## Read an action

Call the detail endpoint with an ID from the list. Its response includes all summary fields plus `changes` and `snapshot`.

For an edit, these additional fields look like:

```json
{
  "changes": {
    "title": {
      "old": "Ballet guide",
      "new": "Updated ballet guide"
    },
    "content": {
      "old": "Original post content",
      "new": "Updated post content"
    }
  },
  "snapshot": null
}
```

Only fields that actually changed appear. Supported fields are `title`, `content`, `category`, `tags`, `coverImageUrl`, `status`, `publicationBlocked`, and `publishedAt`. Category changes contain old/new category summaries or null; tag changes contain old/new arrays of tag summaries. Taxonomy relationships are compared by ID, so reordering identical tags does not count as a change. Blog slugs remain stable during edits.

Actions:

| Action        | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `updated`     | Content, title, taxonomy, cover, or other tracked values changed |
| `published`   | The post was published or its publication block was cleared      |
| `unpublished` | The post became a draft or an admin blocked publication          |
| `deleted`     | The post was deleted; a full pre-deletion snapshot is retained   |

A request that changes both content and publication creates one record. Its action describes the publication change and its `changes` includes all modified fields. Admin unpublishing an already-draft post still logs the change from `publicationBlocked: false` to `true`. Repeating an identical blocked-draft request does not add another record. Successful requests that change no tracked values do not add logs. Rejected, forbidden, invalid, or rolled-back requests do not add logs.

For deletion, `changes` is `{}` and `snapshot` contains the post immediately before deletion:

- ID, title, stable slug, full Markdown content, and author ID.
- Category ID, category summary/name, and tag summaries.
- Cover image URL, status, publication block, and publication time.
- Original creation/update timestamps as ISO strings.

Deleting the live post does not erase these historical values. Old content deliberately remains in audit history. Snapshot taxonomy values also survive later category/tag deletion. The snapshot stores the image URL, not a copy of the image file. Existing image file retention behavior is unchanged. No account emails, passwords, password hashes, or authentication tokens are included.

## Database and implementation

`blog_audit_logs` stores `id`, `blog_id`, `blog_title`, `actor_id`, `post_author_id`, `action`, `changes` (JSONB), `snapshot` (nullable JSONB), and `created_at`. Historical UUIDs deliberately have no foreign keys that could remove the history when a post or user is deleted. An index supports actor/pagination lookup; another indexes the blog ID.

The repository saves audit records inside the same transaction used by existing post mutations. It takes the before-state after acquiring the existing post lock. If inserting the record fails, the edit, moderation, or deletion rolls back. A newly uploaded image is discarded if that transaction fails. There is no asynchronous logger, background worker, generic base service, or separate audit module.

Files:

| File                                                        | Purpose                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `src/blogs/entities/blog-audit-log.entity.ts`               | The new table                                                |
| `src/blogs/enums/blog-audit-action.enum.ts`                 | Four action values                                           |
| `src/blogs/interfaces/blog-audit-log.interface.ts`          | Summary, detail, changes, snapshot, and page types           |
| `src/blogs/dto/list-blog-audit-logs-query.dto.ts`           | Pagination validation                                        |
| `src/blogs/dto/blog-audit-log-response.dto.ts`              | Swagger response documentation                               |
| `src/blogs/blogs.controller.ts`                             | Two protected GET routes                                     |
| `src/blogs/blogs.service.ts`                                | Small methods delegating to the existing repository          |
| `src/blogs/blogs.repository.ts`                             | Record changes, create snapshots, query actor-scoped history |
| `src/blogs/blogs.module.ts`                                 | Register the entity                                          |
| `src/database/migrations/1792490000000-AddBlogAuditLogs.ts` | Optional incremental schema change                           |

With the current development `synchronize: true` configuration, restart the backend with `npm run start` to create the table. For an existing environment with synchronization disabled, run `npm run migration:run` before using post mutations with the new code. No application-database migration is run automatically by this feature. Reverting the audit migration drops the audit table and its history.

Demo seeding does not generate fake audit history. Normal API mutations produce it.

## Postman steps

1. Restart the backend, log in as an author, and create a test post. Keep its blog ID.
2. PATCH `/api/v1/blogs/<blog-id>` with `{"title":"Audit test title"}` using that author's Bearer token.
3. GET `/api/v1/me/blog-audit-logs` with the same token. Expect one `updated` record for that action.
4. Copy the audit record's `id`, then GET `/api/v1/me/blog-audit-logs/<audit-id>`. Check the old/new title values.
5. Repeat the same title update. It should not add another record.
6. Delete the post using its blog ID. Fetch the history again and open the new `deleted` record. Its snapshot should still contain the deleted post.
7. Try opening that record with another author's or an admin's token. Expect 404.
8. To check admin actions, create another author post, log in as admin, and unpublish it through the existing admin status route. That record appears only in the admin's own audit list.

Swagger documents both routes under `blogs` at `/api/docs`. No new authentication mechanism is introduced.

## Verification

```bash
npm test
npm run lint
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/blogs/blog-audit-logs.postgres.spec.ts
```

The opt-in PostgreSQL/HTTP suite creates a random temporary schema and removes it afterward. It exercises real guards, actor privacy (including admins), exact changes, no-op suppression, deletion retention, pagination, moderation blocks, concurrent edits, migration creation, and rollback when an audit insert fails. Image storage is mocked; tests write no real uploaded files, send no email, and do not modify application tables.
