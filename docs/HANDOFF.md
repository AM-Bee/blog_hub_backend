# Backend handoff for the other device

The attached files are the exact backend source written on the first computer for BlogHub mobile offline CRUD. No Render deployment or database migration has been performed. No environment files or credentials are included. These are full source files, not a patch: compare and merge them into the current backend; do not blindly overwrite newer work on this device.

## Required mobile contract

1. Preserve the global /api/v1 prefix. Add authenticated GET and POST /api/v1/me/blog-sync for authors/admins, limited to the authenticated user's OWN posts. Reuse existing JWT/roles guards, DTO validation, post ownership, audit, moderation and image handling.
2. GET: optional after=UUID; return {items: fullBlog[], nextCursor: UUID|null}, sorted by post UUID ascending, twenty posts per page. This is a fresh FULL keyset snapshot scan, not an incremental change cursor. Return version on every blog. The mobile client only reconciles absent synced rows after all pages complete and preserves dirty/concurrently changed local records.
3. POST: {operationId:UUID,entityId:UUID,type:CREATE|UPDATE|DELETE,baseVersion?:positive integer,input?:editable fields}. CREATE uses the stable client entityId and existing create validation; UPDATE/DELETE require baseVersion and reject stale versions with 409. UPDATE of a deleted record is 404; an already missing DELETE target is acknowledged. Return {blog:fullBlog} or {deleted:true,id:UUID}. Status 200. Multipart uploads put operation metadata in text fields, input in one JSON string field and the image in binary field image. Do not send coverImageUrl with an image. Keep the existing image validation and 5 MiB limit; allow a 1,000,000-byte input text field.
4. Idempotency: lock the user/operation pair with a PostgreSQL advisory transaction lock. Compare a SHA-256 request hash, and store the result in post_sync_operations in the SAME transaction as the post/audit mutation. Identical retries return the receipt without writing/uploading again. A reused operation ID with different content is 409. Scope receipts by user. Keep them while any device may retry an old operation. Enable RLS without public receipt policies.
5. Versions: add blogs.version integer NOT NULL DEFAULT 1. Increment with a BEFORE UPDATE trigger, including moderation/category FK changes. A blog_tags AFTER INSERT/DELETE trigger also advances its blog's version. Clients use the returned integer; it may increase by more than one.
6. Existing online PATCH /api/v1/blogs/:id accepts optional expectedVersion. Existing DELETE /api/v1/blogs/:id accepts optional ?version=N. Check after locking and checking ownership; conflicts are 409. Keep old clients compatible when versions are omitted.
7. Repository create/update/remove must accept the synchronization transaction's EntityManager. All reads/writes during an operation must use it; do not open a separate nested transaction or use the global repository to read uncommitted data. Support a supplied stable ID for sync creation, track uploaded URLs for failed outer-transaction cleanup, retain normal online behavior, and keep stable slugs during edits.
8. Increase JSON request-body parsing to 1mb so valid 100,000-character Unicode content fits. Register the new controller/service, add version to the entity/interface/Swagger response and register the migration in data-source.ts. No package or credential changes are required.
## Exact files

NEW:
- src/blogs/dto/sync-post.dto.ts
- src/blogs/post-sync.controller.ts
- src/blogs/post-sync.service.ts
- src/blogs/post-sync.service.spec.ts
- src/database/migrations/1793664000000-AddPostSync.ts
- docs/POST_SYNC.md

MODIFIED:
- src/blogs/entities/blog.entity.ts
- src/blogs/interfaces/blog.interface.ts
- src/blogs/dto/blog-response.dto.ts
- src/blogs/dto/update-blog.dto.ts (also defines DeleteBlogQueryDto)
- src/blogs/blogs.repository.ts
- src/blogs/blogs.service.ts
- src/blogs/blogs.controller.ts
- src/blogs/blogs.module.ts
- src/database/data-source.ts
- src/main.ts
## Verification and rollout

Read this device's AGENTS.md first, compare its current code, and adapt these files without reverting other changes. Check migration-name/timestamp collisions and update class/file/registration consistently if necessary. Run npm test, npm run build, and npm run lint. On the first computer 154 backend tests passed, 55 integration tests were skipped, build passed, and lint had one pre-existing unused APP_FILTER import warning in the chat DTO. The PostgreSQL migration/triggers have NOT been executed against a real database by this task. Test them in isolated staging before production, especially duplicate concurrent operations, receipt/mutation rollback, stale edits, tag/category/admin version changes and image retries.

After review, include this migration in the deployed backend and run npm run migration:run in the intended backend database environment BEFORE starting the new backend version. Never reset/drop the production database. Do not automatically deploy or run production migrations merely from this handoff. Existing Render database and Supabase Storage configuration are reused; no mobile secret is needed.

The mobile app already expects these exact endpoints/response fields. Until the backend update is deployed, online CRUD still uses the existing API; offline posts remain saved on the phone and uploads wait. See docs/POST_SYNC.md for the detailed API contract.