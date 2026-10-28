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

New files are uploaded to the public Supabase Storage bucket `blog-images`, using a generated UUID filename and an extension inferred from the image signature. Original filenames are not used. Multer keeps the file in memory while NestJS validates and uploads it; new uploads are not written to the backend disk.

### Supabase setup

1. Open **Storage → New bucket**. Create `blog-images`, enable **Public bucket**, set the limit to 5 MB, and allow `image/jpeg`, `image/png`, and `image/webp`.
2. Open **Project Settings → API Keys** and create/copy a server secret key (`sb_secret_...`).
3. Configure the backend `.env`, then restart NestJS:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=your-server-secret-key
SUPABASE_STORAGE_BUCKET=blog-images
```

The secret key stays on the backend. Do not put it in frontend code, a `NEXT_PUBLIC_` variable, `.env.example`, or Git. Browser writes are not needed: the normal NestJS guards authorize uploads. Do not add anonymous upload/delete policies to the bucket. The database Data API can remain disabled; Storage is a separate API.

The existing `blogs.cover_image_url` column stores a URL path such as:

```json
{ "coverImageUrl": "https://your-project-ref.supabase.co/storage/v1/object/public/blog-images/550e8400-e29b-41d4-a716-446655440000.png" }
```

The frontend can use this absolute URL directly. The existing `/images` static route still serves older files from `src/asset/images`; existing local files are not copied to Supabase automatically.

Image URLs are publicly accessible, including covers attached to drafts. Blog content and editing routes retain their existing permissions.

## Rules and file lifecycle

- One file, using the field name `image`; JPEG, PNG, and WebP only, maximum 5 MB. File MIME type and image signature must agree. Unsupported/disguised files return 400; oversized uploads return 413.
- Send either an image file or an external `coverImageUrl`, not both. External URLs retain HTTP(S) validation. Uploaded paths are generated internally.
- Omit the image to keep the existing cover during updates. Set `coverImageUrl` to null in JSON, or the text `null` in multipart, to clear the cover reference.
- Failed validation or forbidden mutations upload no file. If a database transaction fails after an upload succeeds, the existing rollback cleanup removes that new object from Supabase. Cleanup errors are reported rather than silently ignored.
- Replacing, clearing, or deleting a blog preserves previously stored image files. Automatic cleanup of old images is not included; this avoids removing images that may be referenced elsewhere.
- Missing Storage configuration, rejected uploads, network failures, or failed cleanup return 503. Requests time out after 30 seconds. A network interruption after an upload reaches Storage, or a failed cleanup request, can leave an unused object; review unused files manually if that happens.

No schema migration is needed for uploads; the existing cover URL column is reused.

## Verification

```bash
npm test -- src/blogs/blog-image.store.spec.ts
```

Unit tests mock the Storage HTTP API and check upload bytes/headers, public URLs, file validation, missing configuration, safe provider errors, rollback deletion, and rejection of foreign paths. They do not upload real files or modify the database. After setting up the bucket/key, test an authenticated multipart blog creation and open its returned cover URL to confirm live Storage delivery.
