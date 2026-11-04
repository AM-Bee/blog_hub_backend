# Roles and admin permissions

The backend remains the authority for access. No frontend/mobile changes are included.

- `author`: existing owner rules, no administrative permissions.
- `admin`: explicit permissions only, empty by default.
- `super_admin`: all administrative permissions; only this role can grant access. Private chat, own-post sync, and editing another author's post remain subject to ownership.

Existing admins receive **no administrative permissions** from the migration. This deliberate change prevents retaining delete access accidentally. Before rolling out, choose the main admin and plan grants for every other admin. Clients must support the new role and use the effective `permissions` array returned by `/api/v1/auth/me` and admin user responses, rather than assuming every admin can delete. Permissions are fetched from the database on every authenticated request; existing access tokens see changes immediately on their next request. In-flight requests already authorized are not cancelled.

## Permission list

| Permission | Allows |
| --- | --- |
| `blogs.moderate` | List/read any blog through admin routes; publish/unpublish/block publishing |
| `blogs.delete` | Delete other authors' blogs |
| `taxonomy.manage` | Edit other users' categories/tags |
| `taxonomy.delete` | Delete categories/tags |
| `comments.delete` | Delete other users' comments/replies |
| `faqs.manage` | Admin FAQ/category listing, creation, editing, activation |
| `faqs.delete` | Delete FAQs and empty FAQ categories |
| `users.manage` | List/read users; enable/disable authors |
| `users.grant_access` | Main admin only: promote authors and replace regular admin permissions |

Delete grants are independent of manage grants. Authors and admins can still edit/delete their own blogs and comments. Taxonomy creation and editing one's own entries remain available as before; deleting taxonomy always requires its delete grant. FAQ deactivation and unpublishing are moderation, not permanent deletion. Only the main admin can enable/disable regular admins. The main admin cannot be demoted, disabled, or have permissions changed through these APIs. There is no new demotion API.

## API

All paths below start with `/api/v1`, require the existing bearer access token, and return the existing admin user response including effective `permissions`.

**Promote an active author (main admin only):** `PATCH /admin/users/:id`

```json
{"role":"admin","permissions":["blogs.moderate","taxonomy.manage"]}
```

Omitting `permissions` when first promoting gives `[]`. Repeating promotion for an existing admin without `permissions` preserves their grants. Providing an array replaces the grants. `super_admin` cannot be assigned by this endpoint.

**Replace grants (main admin only):** `PATCH /admin/users/:id/permissions`

```json
{"permissions":["blogs.moderate","taxonomy.manage"]}
```

Only regular admins can receive grants. `[]` revokes all administrative permissions. Unknown, duplicate, null, non-array, and `users.grant_access` values are rejected. Regular admins cannot grant permissions even when they have `users.manage`.

Existing `GET /admin/users`, `GET /admin/users/:id`, and `PATCH /admin/users/:id/status` require `users.manage`. Unauthorized access returns 401; authenticated users without permission return 403.

## Database and rollout — run only when ready

The migration adds `super_admin` to `users_role_enum` and `users.permissions` (`text[] NOT NULL DEFAULT '{}'`). Existing users, passwords, sessions, posts, and messages are retained. Startup does not run migrations.

1. Back up the database and select the UUID of your existing active main admin.
2. Coordinate deployment with frontend/mobile support for `super_admin` and effective permissions.
3. From the backend folder with the intended database configured, run `npm run migration:run`.
4. Run `npm run admin:make-super -- <existing-active-admin-uuid>` **before using the new admin API**.
5. Start/redeploy the backend and sign in. Verify `/auth/me` returns `super_admin` and all permissions.
6. Assign explicit grants to other admins with the new endpoint; check a restricted admin receives 403 on deletion.

The bootstrap command is a trusted database operation. It validates the target is an existing active admin, uses a transaction and advisory lock, refuses a different second main admin, and can be repeated for the same active main admin. It does not create users or alter passwords. `seed:admin` continues creating a regular admin without grants; it does not select a main admin automatically. There is intentionally no automatic downgrade migration: removing the role requires a deliberate account/permission recovery plan first.

## Files to study

- `src/users/permissions.ts`: permission names and effective access.
- `src/users/entities/user.entity.ts`: stored permission array.
- `src/auth/decorators/permissions.decorator.ts` and `src/auth/guards/roles.guard.ts`: route checks, including main admin inheritance.
- `src/admin-users/`: promotion, grant validation, protected account changes.
- Blog/category/tag/comment repositories: owner-aware checks shared by callers.
- `src/faq/admin-faq.controller.ts`: FAQ administrative permission checks.
- `src/database/migrations/1793750400000-AddAdminPermissions.ts`: schema change only.
- `scripts/make-super-admin.mjs`: explicit main admin bootstrap.
