# Blog search and filtering

Search uses the public endpoint:

```text
GET http://localhost:5300/api/v1/blogs
```

No login, Bearer token, Origin header, or request body is required. Results contain published posts only; drafts remain private.

## Query parameters

| Parameter  | Behavior                                                        | Default / limit                           |
| ---------- | --------------------------------------------------------------- | ----------------------------------------- |
| `q`        | Case-insensitive partial match in the title OR Markdown content | Optional; 1–200 characters after trimming |
| `category` | Exact, case-sensitive category slug                             | Optional; 1–500 characters after trimming |
| `tag`      | Exact, case-sensitive tag slug                                  | Optional; 1–500 characters after trimming |
| `author`   | Case-insensitive partial match in author display name           | Optional; 1–100 characters after trimming |
| `page`     | Positive integer page number                                    | Default 1                                 |
| `limit`    | Positive integer posts per page                                 | Default 10; maximum 50                    |

Use category/tag **slugs**, not names or UUIDs. Copy them from the Categories/Tags API. Slugs change when a category or tag is renamed.

All supplied filters combine with AND. For example, a post must match the search text, selected category, selected tag, and author name when all four are provided. Within `q`, a match in either title or content is sufficient.

`author=bee` matches both “Bee” and “Bee Admin”. Matching authors need not have unique display names; published posts from every matching author can appear. Surrounding whitespace is removed from filter values. `%`, `_`, and backslash in `q` or `author` are treated as literal text, not wildcard operators.

## EchoAPI examples

Choose GET, open the Params tab, and add the desired parameters. Leave the request body empty. EchoAPI handles URL encoding for parameter values.

Search title/content:

```text
http://localhost:5300/api/v1/blogs?q=ballet
```

Filter by category or tag:

```text
http://localhost:5300/api/v1/blogs?category=dancing
http://localhost:5300/api/v1/blogs?tag=beginner
```

Filter by author display name:

```text
http://localhost:5300/api/v1/blogs?author=bee
http://localhost:5300/api/v1/blogs?author=Bee%20Admin
```

Combine filters and pagination:

```text
http://localhost:5300/api/v1/blogs?q=ballet&category=dancing&tag=beginner&author=bee&page=1&limit=10
```

Remove a parameter to remove its restriction. Do not send an empty value such as `author=`; it returns 400.

## Response and ordering

Responses use the existing paginated blog format:

```json
{
  "items": [],
  "page": 1,
  "limit": 10,
  "total": 0,
  "totalPages": 0
}
```

This example means no published posts match. Unknown category/tag slugs or author names also return an empty result with status 200.

`total` counts matching published posts before pagination; `totalPages` is the number of matching pages. A page beyond the last page returns empty `items` while retaining the matching totals. Posts sort by first publication time descending, then ID descending. A post with multiple tags appears only once.

Items contain blog metadata and an `excerpt` consisting of the first 200 Unicode characters of stored Markdown. Fetch full content through `GET /api/v1/blogs/<blog-slug>`. Author responses include ID and display name; email and password fields remain private. See [BLOGS.md](BLOGS.md) for the complete post response and CRUD routes.

## Validation and special cases

- Empty/blank filters, values exceeding their length limits, repeated filter parameters/arrays, or invalid types return 400.
- Invalid pagination, including zero, negative values, fractional values, or `limit` above 50, returns 400.
- Public `status` filtering is not supported: `/blogs` always lists published posts.
- `/me/blogs` and `/admin/blogs` support pagination and optional draft/published `status`, but do not accept `q`, `category`, `tag`, or `author`.
- Posts whose category was deleted remain searchable by content and author as “Uncategorized”. Their former category/tag slugs no longer match them.

## Verification

Search/filter DTO checks run with `npm test`. PostgreSQL checks cover combined filters, partial author matching, title/content matching, draft privacy, filtered totals/pagination, literal wildcard characters, and category deletion:

```bash
BLOGHUB_RUN_DB_TESTS=1 npx vitest run src/blogs/blogs.postgres.spec.ts
```

The database checks create and remove a temporary schema using local `.env` credentials; existing application tables are preserved.
