# Post synchronization

Apply `AddPostSync1793664100000` with `npm run migration:run` using the intended database configuration before serving the updated backend. No production migration has been performed by the coding task.

## Versioning

Blog responses include `version`. A PostgreSQL trigger increments this integer for every blog-row update, including admin moderation and foreign-key category changes. A join-table trigger also increments the blog version when tag links change. Versions may advance by more than one and clients must use the returned value.

Normal `PATCH /api/v1/blogs/:id` accepts optional `expectedVersion`. Normal `DELETE /api/v1/blogs/:id?version=N` accepts an optional expected version. These checks happen after locking the post and checking ownership. The optional fields preserve compatibility with existing clients. New mobile clients send them when available.

## Idempotent writes

`POST /api/v1/me/blog-sync` requires JWT authentication and an author/admin role. It handles only the authenticated user's own posts; an admin does not gain access to another author's private queue through this route.

JSON input:

```json
{
  "operationId": "a persistent UUID for this exact operation",
  "entityId": "the post UUID generated on the phone",
  "type": "UPDATE",
  "baseVersion": 3,
  "input": { "title": "Edited title", "content": "Edited Markdown" }
}
```

Use valid UUID values in requests. `CREATE` requires the existing `CreateBlogDto` fields in `input`; `UPDATE` uses `UpdateBlogDto`; `DELETE` has no `input` or image. Edits and deletions require a positive integer `baseVersion`.

Covers use multipart form data: operation metadata as text fields, `input` as a JSON string, and `image` as the binary file field. Existing JPEG/PNG/WebP validation and the 5 MiB limit still apply. Do not send `coverImageUrl` alongside an image.

An advisory transaction lock serializes retries of the same user/operation pair. A SHA-256 request hash guards accidental reuse of an operation UUID with different content. The post mutation, audit entry, and receipt commit in the same database transaction, using that transaction's entity manager. A confirmed retry returns the stored result without uploading or writing again. The receipt table enables RLS and has no public API policies. Keep receipts for as long as a device could retry a historical operation.

Responses are `{ "blog": ... }` or `{ "deleted": true, "id": ... }`. A missing delete target is already deleted and can be acknowledged. Stale versions/reused operation IDs produce 409; another owner produces 403; updates of deleted posts produce 404. Validation and permanent authorization failures should not be retried forever.

## Server-to-device refresh

`GET /api/v1/me/blog-sync?after=<last UUID>` returns `{ "items": [full own posts], "nextCursor": "UUID or null" }`, at most twenty posts per page. Posts are sorted by UUID. Start a fresh scan without `after` on each refresh; this is a complete snapshot scan, not an incremental change cursor.

Only reconcile absent records after every page succeeds. Preserve pending local changes, and compare the local revision/version captured at scan start before removing a synced row. Concurrent changes may appear on the next scan. The client must never purge its cache after an interrupted or partial scan.

## Checks

`npm test`, `npm run build`, and `npm run lint` cover the existing backend plus synchronization unit tests. Opt-in database checks below verify transaction/trigger behavior in disposable schemas. Do not point tests at production application tables.

## Merge into the main backend

The handoff's migration timestamp `1793664000000` was already used by the FAQ
migration here. This repository registers **AddPostSync1793664100000** in
`src/database/migrations/1793664100000-AddPostSync.ts`, after the existing FAQ
migration. Comments, reactions, FAQs, and all earlier migration registrations are
preserved. No packages, environment settings, authentication rules, CORS settings,
or storage credentials were replaced. No backend AGENTS.md was present during
this merge. The original `docs/HANDOFF.md` is preserved unchanged.

The receipt table has a TypeORM entity in
`src/blogs/entities/post-sync-operation.entity.ts`. Receipt reads and writes use
the operation's transaction manager and configured database schema. UUID casing
is normalized before hashing/locking; binary image bytes and MIME type are included
in the request hash. An additional entity lock serializes operations that use
different operation IDs for the same stable post ID. Failed outer transactions
have one image cleanup owner, avoiding duplicate storage deletion attempts.
Database and storage commits cannot be atomic: a storage outage during cleanup
can leave an unused image requiring later cleanup.

The tag-version trigger explicitly targets the schema in which the migration was
applied. Snapshot and write response schemas are documented in Swagger. JSON
parsing uses Nest's `useBodyParser` with a `1mb` limit, retaining existing middleware.
Multipart input fields allow 1,000,000 bytes; image files still use the existing
5 MiB limit and JPEG/PNG/WebP checks.

### Requests

Create (the `entityId` is generated and retained on the device):

```json
{
  "operationId": "849c0696-f707-42b5-8146-6f9cb3f0c37f",
  "entityId": "f03a79ae-1bf8-4bf6-a5c6-390fedfa6414",
  "type": "CREATE",
  "input": {
    "title": "Offline story",
    "content": "Markdown saved on the phone",
    "categoryId": "replace-with-a-real-category-uuid",
    "status": "draft"
  }
}
```

Use real UUIDs for category and tag relationships. Edit with a **new** operationId,
the same entityId, and `baseVersion` from the returned blog. Delete with a new
operationId, the same entityId, positive baseVersion, and no input/image. Keep the
original operationId and request unchanged when retrying a lost response. Receipts
can return an older confirmed result after a later edit or deletion; complete a
fresh GET scan to obtain current server state. Do not change old operation input
and retry with its existing operationId.

Sync CREATE appends the stable entity UUID to its generated slug to avoid retry
slug changes. Online creation retains its existing slug behavior. Subsequent
edits preserve either slug. Versions advance on all blog-row updates and tag-link
insertions/deletions, so adding/removing multiple tags can advance them multiple
times. They are not timestamps or incremental snapshot cursors.

### Verification without production changes

```bash
npm test
npm run build
npm run lint
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e -- --testNamePattern '^.*sync'
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/database/migrations/initial-schema.spec.ts
```

The opt-in database tests create and remove disposable schemas. The full
application test uses migrations in its disposable schema rather than automatic
schema synchronization. It verifies own-post access, stable IDs, keyset paging,
scoped receipts, duplicate/concurrent operations, optimistic conflicts, legacy
online writes, moderation/category/tag version changes, receipt/audit rollback,
image retry/cleanup, and 100,000-character Unicode JSON/multipart bodies. Storage
calls are mocked in these API tests; existing image-store tests cover validation
and storage HTTP behavior separately.

RLS is enabled on `post_sync_operations` with no public policies. NestJS uses its
existing privileged database connection and enforces user ownership. Do not expose
receipt results through a public API, grant frontend database access, or prune
receipts while devices can retry historical operations.

No deployment or application-schema migration is part of this merge. Before a
future rollout, review the diff and back up the intended database, then apply
migrations **before** starting the new server version: its blog queries now require
the version column. Coordinate that rollout separately; do not run production
migrations merely to exercise these tests.
