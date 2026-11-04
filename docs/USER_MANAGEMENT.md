# Admin user management

List/detail/status routes require `users.manage` or an active `super_admin`. Promotion and permission assignment require `super_admin`. See [ADMIN_PERMISSIONS.md](ADMIN_PERMISSIONS.md) for migration and main-admin setup. These routes require an active account and `Authorization: Bearer <accessToken>`. In EchoAPI, log in as admin, copy the access token, and choose Auth → Bearer Token. Paste only the token. Login requires the configured Origin header; these admin routes do not.

All paths below start with `http://localhost:5300/api/v1`.

## List users

`GET /admin/users`

Optional query parameters:

| Parameter | Meaning | Default |
| --- | --- | --- |
| `page` | Page number, 1–1,000,000 | 1 |
| `limit` | Items per page, 1–50 | 10 |
| `q` | Case-insensitive partial display name or email; surrounding spaces trimmed | No search |
| `role` | `author`, `admin`, or `super_admin` | All |
| `status` | `active` or `disabled` | Both |

Example: `GET /admin/users?q=bee&role=author&status=active&page=1&limit=10`

Filters combine with AND. `%`, `_`, and backslashes in search are treated literally. Empty/whitespace-only search means no search. Results are newest accounts first, with ID as the tie-breaker.

```json
{
  "items": [
    {
      "id": "author-user-uuid",
      "displayName": "Bee",
      "email": "bee@example.com",
      "role": "author",
      "permissions": [],
      "status": "active",
      "createdAt": "2026-10-12T00:00:00.000Z",
      "updatedAt": "2026-10-12T00:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1
}
```

## View a user

`GET /admin/users/:id`

Replace `:id` with an actual user UUID from the list. Returns the same profile fields plus `blogCount`, counting both drafts and published blogs. Admins with `users.manage` may view author, admin, and main admin accounts. No password hashes, reset data, or session tokens are returned.

## Enable or disable an author

`PATCH /admin/users/:id/status`

Use raw JSON with `Content-Type: application/json`:

```json
{
  "status": "disabled"
}
```

To enable the account again:

```json
{
  "status": "active"
}
```

Returns HTTP 200 with the updated profile and `blogCount`.

- Admins with `users.manage` can change author status. Only the main admin can change regular admin status. Main admin status is protected.
- Disabling revokes every login session and clears outstanding password-reset codes in the same transaction.
- Disabled users cannot log in, refresh tokens, access protected routes, or recover their password. Forgot-password still returns its generic response but sends no email.
- Re-enabling preserves the password and requires a fresh login. Old sessions and reset codes remain invalid.
- Blogs, categories, tags, and images are preserved. Published blogs remain public; drafts remain private.
- Sending the same status again is allowed. Repeated disable requests still revoke any sessions and clear reset codes.
- No account deletion, admin profile editing, or admin password override routes are provided.

## Promote an author to admin

`PATCH /admin/users/:id`

Sign in as the active main admin. Send this JSON body with its Bearer token (optional `permissions` chooses initial grants):

```json
{
  "role": "admin"
}
```

For the deployed backend, the full URL is:

```text
PATCH https://blog-hub-backend-cnzm.onrender.com/api/v1/admin/users/<user-uuid>
```

Returns HTTP 200 with the updated profile and `blogCount`, without credentials.

- Authors cannot promote themselves or anyone else; their requests return 403.
- Disabled authors must be enabled through `PATCH /admin/users/:id/status` first. Promotion does not enable disabled accounts.
- Repeating the request for an existing admin without `permissions` preserves its current grants.
- Only `role: "admin"` is accepted; `permissions` may contain assignable permission names. Demotion, other role names, and unknown fields are rejected with 400.
- Existing posts and login sessions are preserved. Authentication reads the current database role, so the new permissions apply on the next authenticated request. Refresh `/auth/me` in the frontend to update its displayed role.
- Promotion without an explicit permissions list grants no administrative permissions. Own-content rights remain unchanged. Regular admins cannot promote users or grant access.

## Replace admin permissions

`PATCH /admin/users/:id/permissions` (main admin only):

```json
{"permissions":["blogs.moderate","taxonomy.manage"]}
```

Send `[]` to revoke all administrative permissions. Targets must be regular admins. Unknown permissions, duplicates, and reserved `users.grant_access` are rejected. Effective permissions are included in profiles and reflect changes on the next authenticated request.

A migration and explicit main admin selection are required. Follow [ADMIN_PERMISSIONS.md](ADMIN_PERMISSIONS.md); this does not automatically elevate existing admins.

## Setup and testing

Apply the migration and bootstrap plan in ADMIN_PERMISSIONS.md before restarting/deploying this version; coordinate frontend/mobile support first. Swagger documents the routes under `admin-users` at `/api/docs`. `/auth/me` includes the account status, role, and effective permissions. Automatic schema synchronization is disabled; fresh databases use `npm run migration:run` as described in [SUPABASE.md](SUPABASE.md).

Useful EchoAPI checks:

| Check | Expected |
| --- | --- |
| Missing/invalid/expired Bearer token | 401 |
| Author token on any admin user route | 403 |
| Regular admin tries to change an admin's status | 403 |
| Regular admin calls promotion or grant API | 403 |
| Invalid UUID, invalid status/filter, extra request fields, or invalid pagination | 400 |
| Unknown valid user UUID | 404 |
| Disabled author uses an old access or refresh token | 401 |
| Re-enabled author uses an old access token | 401; log in again |
| Author calls the promotion route | 403 |
| Main admin promotes a disabled author | 403; enable the author first |
| Main admin promotes an active author | 200; returned role is `admin` |
| Repeated promotion without permissions | 200; `updatedAt` is unchanged |
| Demotion or unknown promotion fields | 400 |

The promotion acceptance test uses a uniquely named temporary PostgreSQL schema. It checks real HTTP authentication, author rejection, missing users, UUID and body validation, disabled-account rejection, safe responses, database persistence, repeated promotion, and immediate permission changes for an existing token. It does not modify application users or send emails.

```bash
npm test -- src/admin-users/dto/update-user-role.dto.spec.ts
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e -- --testNamePattern "promotes authors"
```
