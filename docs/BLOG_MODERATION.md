# Blog publication moderation

Admins can publish or unpublish any post through a dedicated status route. Editing another user's title, content, image, category, or tags remains forbidden.

## Admin route

`PATCH http://localhost:5300/api/v1/admin/blogs/:id/status`

Use the blog UUID, not its slug. In EchoAPI select **Auth → Bearer Token** and paste an admin access token. Use raw JSON with `Content-Type: application/json`. No Origin header is required on this route; login still requires the allowed frontend Origin.

Unpublish and block author publishing:

```json
{
  "status": "draft"
}
```

Publish and clear the block:

```json
{
  "status": "published"
}
```

Both return HTTP 200 with the full updated blog. The response includes:

```json
{
  "status": "draft",
  "publicationBlocked": true
}
```

This example shows only the relevant response fields. The API also returns the usual blog content, author, taxonomy, and timestamps.

## Behavior

| Action                                                 | Result                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Author creates/edits an ordinary draft                 | `publicationBlocked: false`; author can publish                |
| Owner unpublishes through `PATCH /blogs/:id`           | Draft; an existing moderation block is preserved               |
| Admin sends `draft` through the admin status route     | Draft with `publicationBlocked: true`, even if already a draft |
| Author edits an admin-unpublished post                 | Allowed; post remains a blocked draft                          |
| Author tries to publish a blocked post                 | HTTP 403; no fields or image upload are saved                  |
| Admin sends `published` through the admin status route | Published with `publicationBlocked: false`                     |

Unpublished posts disappear from public search/listing, and their public detail route returns 404. They remain accessible to the owner through `/me/blogs` and `/me/blogs/:id`, and to admins through `/admin/blogs` and `/admin/blogs/:id`.

Only the dedicated admin status route clears a block. Even an admin editing their own blocked post through the ordinary owner update route must use the admin status route to publish it again. Once the block is cleared, the author can publish/unpublish normally until an admin blocks it again.

The first `publishedAt` timestamp is preserved through unpublishing and republishing. Publishing a never-published draft sets it for the first time. Content, slug, images, taxonomy, and ownership are preserved by moderation. No separate review-request or notification flow is added. Existing owner/admin deletion permissions are unchanged.

`publicationBlocked` is returned in blog details and summaries and is read-only. Clients cannot set it through create, edit, or admin status payloads. The admin status route accepts only `status`.

## EchoAPI verification

1. Log in as an author and create a published post. Save its `id` and `slug`.
2. Log in as admin and send `{"status":"draft"}` to the admin status route with that post's UUID. Expect `draft` and `publicationBlocked: true`.
3. Call public `GET /api/v1/blogs/:slug`. Expect 404; the post is also absent from public listings.
4. With the author's token, send a title/content edit to `PATCH /api/v1/blogs/:id`. Expect 200 and the block to remain true.
5. With the author's token, send `{"status":"published"}` to the ordinary edit route. Expect 403. Sending `draft` first cannot remove the block.
6. With the admin token, send `{"status":"published"}` to the admin status route. Expect 200 and `publicationBlocked: false`.
7. Confirm the public detail route works again. The owner can now publish/unpublish normally.

| Invalid request                                                      | Expected status |
| -------------------------------------------------------------------- | --------------- |
| Missing/invalid/expired access token                                 | 401             |
| Author calls admin status route, including for their own post        | 403             |
| Admin edits another author's content through the ordinary edit route | 403             |
| Invalid UUID, missing/null/invalid status, or extra fields           | 400             |
| Unknown valid blog UUID                                              | 404             |

## Setup and tests

Restart the backend after updating. The current development `synchronize: true` setup adds the `blogs.publication_blocked` boolean column with default `false`, including existing posts. If synchronization is disabled, add the column through a migration before deployment. Swagger documents the route and flag at `/api/docs`.

The implementation locks the post row in the same transaction used by owner updates, preventing an author from bypassing a completed admin unpublish with a concurrent publish request.

Unit tests cover permissions, blocked edits/publishing, flag tampering, and image-write prevention. Integration tests use a unique temporary PostgreSQL schema and real HTTP guards to verify public visibility, admin-only status changes, timestamp preservation, reapproval, and concurrency. Email delivery is mocked and application data is untouched.

```bash
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/blogs/blogs.moderation.postgres.spec.ts
```
