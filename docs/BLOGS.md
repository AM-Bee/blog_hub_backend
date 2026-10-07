# Blogs API

All paths below are relative to `/api/v1`. Swagger is available at `/api/docs`.

Visitors can read published blogs. Authors can create blogs and edit/delete their own posts. Admins can edit/delete any post and read all drafts. Ownership comes from the access token; requests cannot set an author, slug, or publication timestamp.

| Method | Path               | Access                                            |
| ------ | ------------------ | ------------------------------------------------- |
| GET    | `/blogs`           | Public published listing                          |
| GET    | `/blogs/:slug`     | Public published detail; drafts return 404        |
| GET    | `/me/blogs`        | Signed-in author's own drafts and published posts |
| GET    | `/me/blogs/:id`    | Own post detail, including drafts                 |
| GET    | `/admin/blogs`     | Admin; all authors' posts                         |
| GET    | `/admin/blogs/:id` | Admin; any post detail                            |
| POST   | `/blogs`           | Author/admin; creates own post, returns 201       |
| PATCH  | `/blogs/:id`       | Owner/admin; returns updated post                 |
| DELETE | `/blogs/:id`       | Owner/admin; permanent deletion, returns 204      |

## EchoAPI examples

Log in as described in [AUTH.md](AUTH.md), then use these headers on protected requests:

```text
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Blog routes do not require an Origin header. Login, refresh, and logout retain their Origin requirement.

Create a draft with `POST http://localhost:5300/api/v1/blogs`:

```json
{
  "title": "Ballet basics",
  "content": "# Ballet\nMy first post about ballet.",
  "categoryId": "<existing-dancing-category-uuid>",
  "tagIds": ["<existing-ballet-tag-uuid>"]
}
```

Use real UUIDs from the Categories/Tags API. `title`, `content`, and `categoryId` are required. `tagIds` defaults to an empty list, `status` defaults to `draft`, and `coverImageUrl` defaults to null. To publish immediately, include `"status": "published"`.

Publish an existing post with `PATCH http://localhost:5300/api/v1/blogs/<blog-uuid>`:

```json
{ "status": "published" }
```

Use `"status": "draft"` to unpublish. The first publication timestamp is preserved through edits and republishing. Blog slugs stay stable when titles change; category/tag slugs still regenerate when renamed.

PATCH accepts any combination of the creation fields and requires at least one field. Omitted fields remain unchanged. Set `coverImageUrl` to null to clear it, or `tagIds` to `[]` to remove all tags. When changing category, omitted tags are cleared; explicitly supplied tags must belong to the new category.

## Validation and relationships

- Titles are trimmed, nonblank, and at most 200 characters. Content is nonblank Markdown, at most 100,000 characters. It is stored without rendering; sanitize rendered Markdown in the frontend.
- New posts require an existing category. Up to 10 distinct tag UUIDs are allowed, all under that category. Missing or cross-category tags return 400; missing categories return 404.
- Cover URLs must use HTTP or HTTPS and be at most 2,048 characters. The API stores the URL without fetching the image.
- Malformed UUIDs, empty updates, invalid fields, and attempts to set ownership/slug/timestamps return 400. Missing/expired authentication returns 401; forbidden actions return 403.
- Blog changes and tag links are saved in a PostgreSQL transaction. Duplicate titles are allowed; a UUID suffix resolves slug collisions.

Admin category deletion preserves posts using `ON DELETE SET NULL`. Responses then contain `categoryId: null`, `category: null`, and `categoryName: "Uncategorized"`. Category tags and their blog links cascade away. Authors/admins can still edit the post and later assign another category. Adding tags requires a category. Deleting a tag or blog removes its links without deleting unrelated posts or taxonomy entries.

## Listing and responses

For dedicated search/filter instructions and EchoAPI examples, see [search.md](search.md).

All three listing routes accept `page` (default 1) and `limit` (default 10, maximum 50), both positive integers. Own/admin lists also accept `status=draft` or `status=published`. Public lists always return published posts. The public listing also accepts the following optional filters, combined with AND:

| Parameter  | Matching                                                                            |
| ---------- | ----------------------------------------------------------------------------------- |
| `q`        | Case-insensitive partial match in title OR Markdown content; maximum 200 characters |
| `category` | Exact category slug; maximum 500 characters                                         |
| `tag`      | Exact tag slug; maximum 500 characters                                              |
| `author`   | Case-insensitive partial author display-name match; maximum 100 characters          |

Filter values are trimmed. Supplied empty/blank values, repeated parameters/arrays, and invalid types return 400. Category/tag slugs are case-sensitive; use the slug returned by their APIs. Unknown slugs or author names return an empty page. Author display names need not be unique: all matching authors' published posts are returned. `%`, `_`, and backslash in search/author text are literal characters, not wildcard operators. An omitted filter adds no restriction. Own/admin listings retain pagination and status filtering; public search parameters are not accepted there.

Examples:

```text
GET /api/v1/blogs?page=1&limit=10
GET /api/v1/blogs?q=ballet&category=dancing&tag=beginner&author=bee&page=1&limit=10
GET /api/v1/me/blogs?status=draft&page=1&limit=10
GET /api/v1/admin/blogs?status=published
```

Lists return `{ items, page, limit, total, totalPages }`. Published lists sort by first publication time descending, then ID; own/admin lists sort by creation time descending, then ID. Out-of-range pages return empty items; empty results have zero total pages.

Post responses include ID, title, slug, safe author `{ id, displayName }`, category ID and category summary, category name, tag summaries, cover URL, status, and timestamps. List items contain an `excerpt` of the first 200 Unicode characters of Markdown; detail/create/update responses contain full `content`. Author email and password fields are never returned.

## Database and verification

The local database now has the `blogs` and `blog_tags` tables, indexes, and foreign keys; existing records were preserved and no schema changes remain pending. The app still uses `synchronize: true` for fresh local setups. General migrations remain pending. Restart the backend to load the new routes.

Run `npm test` for unit/module checks. To run the PostgreSQL integration suite:

```bash
BLOGHUB_RUN_DB_TESTS=1 npx vitest run src/blogs/blogs.postgres.spec.ts
```

It uses local `.env` database credentials to create a uniquely named temporary schema, runs checks only against tables in that schema, and removes it afterward. The database user needs permission to create a schema. Existing application tables are preserved. The suite checks draft privacy, ownership/admin permissions, publishing, slug collisions, pagination, atomic validation, category deletion preserving posts, combined search/filter matching, literal wildcard handling, and filtered pagination.
