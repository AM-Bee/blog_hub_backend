# Admin user management

These routes require an active admin account and `Authorization: Bearer <accessToken>`. In EchoAPI, log in as admin, copy the access token, and choose Auth → Bearer Token. Paste only the token. Login requires the configured Origin header; these admin routes do not.

All paths below start with `http://localhost:5300/api/v1`.

## List users

`GET /admin/users`

Optional query parameters:

| Parameter | Meaning | Default |
| --- | --- | --- |
| `page` | Page number, 1–1,000,000 | 1 |
| `limit` | Items per page, 1–50 | 10 |
| `q` | Case-insensitive partial display name or email; surrounding spaces trimmed | No search |
| `role` | `author` or `admin` | Both |
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

Replace `:id` with an actual user UUID from the list. Returns the same profile fields plus `blogCount`, counting both drafts and published blogs. Admins may view author and admin accounts. No password hashes, reset data, or session tokens are returned.

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

- Only author accounts can change status. An admin cannot change their own status or another admin's status.
- Disabling revokes every login session and clears outstanding password-reset codes in the same transaction.
- Disabled users cannot log in, refresh tokens, access protected routes, or recover their password. Forgot-password still returns its generic response but sends no email.
- Re-enabling preserves the password and requires a fresh login. Old sessions and reset codes remain invalid.
- Blogs, categories, tags, and images are preserved. Published blogs remain public; drafts remain private.
- Sending the same status again is allowed. Repeated disable requests still revoke any sessions and clear reset codes.
- No deletion, role changes, admin profile editing, or admin password override routes were added.

## Setup and testing

Restart the backend after updating the code. The current development TypeORM `synchronize: true` configuration adds the `users.status` enum column and defaults existing/new accounts to `active`. Environments with synchronization disabled need a migration before deploying this change. Swagger documents the routes under `admin-users` at `/api/docs`. `/auth/me` now also includes the account status.

Useful EchoAPI checks:

| Check | Expected |
| --- | --- |
| Missing/invalid/expired Bearer token | 401 |
| Author token on any admin user route | 403 |
| Admin tries to change an admin's status | 403 |
| Invalid UUID, invalid status/filter, extra request fields, or invalid pagination | 400 |
| Unknown valid user UUID | 404 |
| Disabled author uses an old access or refresh token | 401 |
| Re-enabled author uses an old access token | 401; log in again |

Integration tests use a uniquely named temporary PostgreSQL schema and mocked email delivery. They cover real HTTP guards/validation, filters, pagination, safe responses, blog preservation, revocation, password-reset invalidation, re-enabling, and concurrent login/disable. They do not modify application rows or send emails.

```bash
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/admin-users/admin-users.postgres.spec.ts src/users/account.postgres.spec.ts
```
