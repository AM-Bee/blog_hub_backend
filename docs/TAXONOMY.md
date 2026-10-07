# Categories and Tags API

Categories and tags use the same permissions. Each tag belongs to one required category, and each category can have many tags. All paths are relative to `/api/v1`; Swagger documentation is at `/api/docs`.

| Action    | Visitor        | Author           | Admin     |
| --------- | -------------- | ---------------- | --------- |
| List/read | Allowed        | Allowed          | Allowed   |
| Create    | Requires login | Allowed          | Allowed   |
| Edit      | Requires login | Own entries only | Any entry |
| Delete    | Requires login | Forbidden        | Allowed   |

Creation and editing take effect immediately, without approval. Ownership always comes from the signed-in account and cannot be changed through a request.

## Endpoints

| Method | Categories          | Tags          | Result                                        |
| ------ | ------------------- | ------------- | --------------------------------------------- |
| GET    | `/categories`       | `/tags`       | 200; array sorted by normalized name, then ID |
| GET    | `/categories/:slug` | `/tags/:slug` | 200; one entry                                |
| POST   | `/categories`       | `/tags`       | 201; created entry                            |
| PATCH  | `/categories/:id`   | `/tags/:id`   | 200; updated entry                            |
| DELETE | `/categories/:id`   | `/tags/:id`   | 204; no response body                         |

Reads use slugs; editing and deleting use UUIDs. Tag responses also include `categoryId`. Use `GET /tags?categoryId=<category-uuid>` to list tags under a category. An unknown category returns 404; a malformed category UUID returns 400. Each entry contains `id`, `name`, `slug`, `createdById`, `createdAt`, and `updatedAt`. Internal normalized names and creator email/password fields are not returned.

## Testing with EchoAPI

First log in using the Auth API and copy the returned `accessToken`. For create/update/delete, add:

```text
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Category/tag endpoints use Bearer authentication and do not require the cookie-operation `Origin` header. Login, refresh, and logout still require it as described in [AUTH.md](AUTH.md).

Create a category:

```text
POST http://localhost:5300/api/v1/categories
```

```json
{ "name": "Web Development" }
```

Create a tag using `POST http://localhost:5300/api/v1/tags` with an existing category ID:

```json
{ "name": "Ballet", "categoryId": "<dancing-category-uuid>" }
```

Authors can add tags to any existing shared category. Each tag keeps its own creator for edit permissions. Tag PATCH bodies accept only `name`; moving tags between categories is not supported. Read the returned `slug` for public detail requests and `id` for PATCH/DELETE.

Names must contain a letter or number and be 1–100 characters after whitespace normalization. Surrounding whitespace is removed and repeated internal whitespace becomes a single space. Capitalization is preserved for display, but duplicate checks ignore it:

- `Technology`, `technology`, and `TECHNOLOGY` are duplicates.
- `Web  Development` and `Web Development` are duplicates.
- `WebDevelopment` and `Web Development` are different names.

Category names are unique across categories. Tag names are unique only within their parent category: Ballet under Dancing and Ballet under Performing Arts are both allowed, while another ballet under Dancing returns 409. A category and a tag can have the same name. Duplicate creation or renaming returns 409, including concurrent requests. Renaming an entry to its own normalized name is allowed.

Slugs support Unicode letters/numbers and combining marks and regenerate on a rename request. The old slug URL stops working. Slugs remain globally unique within each resource because detail routes use `/tags/:slug` and `/categories/:slug`; a UUID suffix resolves collisions, including tags with the same name in different categories. Renaming repairs older entries whose slug no longer matches their name.

Category create/update and tag update bodies accept only `name`. Tag creation requires `name` and `categoryId`. Empty PATCH requests and attempts to set `createdById`, `slug`, `id`, or `role` return 400. Invalid UUIDs return 400, missing/expired login returns 401, forbidden edits/deletes return 403, and missing entries return 404.

## Database scope

The existing app configuration still uses `synchronize: true`. The user-requested tag reset deletes existing tags and adds the required category foreign key plus per-category name uniqueness. Categories and users are retained. `scripts/reset-tags-for-category-link.mjs` records this one-time operation and requires an explicit `--delete-existing-tags` flag; do not rerun it unless you intend to delete all tags again. General migrations remain a separate foundation task.

Deleting a category as an admin also deletes all tags under that category through PostgreSQL ON DELETE CASCADE, including tags created by other authors. Tags under other categories are unaffected. Authors still cannot delete categories or tags. The foreign key prevents orphaned tags.

`scripts/enable-category-tag-cascade.mjs` updates an existing category/tag foreign key to this policy without deleting records. It was applied to the local database; future category deletions cascade automatically.

Blogs are preserved when a category is deleted: their category becomes null and responses show `categoryName: "Uncategorized"`. Child tags and their blog links are deleted, but post content remains. Deleting an individual tag also removes its blog links without deleting posts. See [BLOGS.md](BLOGS.md).
