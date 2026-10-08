# Blog image uploads

Create or update a blog with one optional cover image using Multer and `multipart/form-data`:

```text
POST http://localhost:5300/api/v1/blogs
PATCH http://localhost:5300/api/v1/blogs/<blog-uuid>
```

Both routes require `Authorization: Bearer <accessToken>`. Authors and admins can update only their own posts. Existing JSON requests remain supported.

## EchoAPI

Choose **Body → form-data**, then add:

| Key          | Type | Example                           |
| ------------ | ---- | --------------------------------- |
| `title`      | Text | Ballet basics                     |
| `content`    | Text | My first ballet post              |
| `categoryId` | Text | An existing category UUID         |
| `tagIds`     | Text | `["<tag-uuid>"]` or `[]`          |
| `status`     | Text | `draft` or `published`            |
| `image`      | File | Choose a JPEG, PNG, or WebP image |

Create requires title, content, and categoryId. Tags, status, and image are optional. Supply tag IDs as a JSON array in a text field; they must belong to the selected category. For PATCH, send only the fields you want to change; an image-only update is allowed.

Let EchoAPI set the multipart Content-Type and boundary automatically. Remove any manually configured `Content-Type: application/json` header. Swagger at `/api/docs` also documents multipart uploads.

## Storage and URLs

Files are stored in `src/asset/images` relative to the repository root, using a generated UUID filename and an extension inferred from the image signature. Original filenames are not used. Uploaded files are ignored by Git, and the directory remains outside `dist` so rebuilding does not erase uploads. Run the application from the repository root and retain this folder when moving the backend.

The existing `blogs.cover_image_url` column stores a URL path such as:

```json
{ "coverImageUrl": "/images/550e8400-e29b-41d4-a716-446655440000.png" }
```

The backend serves it at:

```text
http://localhost:5300/images/550e8400-e29b-41d4-a716-446655440000.png
```

`/images` is outside the `/api/v1` prefix. On a frontend running on a different origin, resolve the returned path against the backend origin:

```ts
const imageUrl = new URL(blog.coverImageUrl, 'http://localhost:5300').href;
```

Image URLs are publicly accessible, including covers attached to drafts. Blog content and editing routes retain their existing permissions.

## Rules and file lifecycle

- One file, using the field name `image`; JPEG, PNG, and WebP only, maximum 5 MB. File MIME type and image signature must agree. Unsupported/disguised files return 400; oversized uploads return 413.
- Send either an image file or an external `coverImageUrl`, not both. External URLs retain HTTP(S) validation. Uploaded paths are generated internally.
- Omit the image to keep the existing cover during updates. Set `coverImageUrl` to null in JSON, or the text `null` in multipart, to clear the cover reference.
- Failed validation or forbidden mutations write no file. A failed database transaction removes its newly uploaded file.
- Replacing, clearing, or deleting a blog preserves previously stored image files. Automatic cleanup of old images is not included; this avoids removing images that may be referenced elsewhere.

No schema migration is needed for uploads; the existing cover URL column is reused.

## Verification

```bash
BLOGHUB_RUN_HTTP_TESTS=1 BLOGHUB_RUN_DB_TESTS=1 npm test
```

HTTP checks exercise multipart parsing, storage/static serving, authentication, invalid fields/files, size limits, JSON compatibility, and image-only updates. PostgreSQL checks verify URL persistence, ownership, and cleanup after failed transactions. Tests clean up the image files they create and use an isolated database schema.
