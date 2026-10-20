# Google login (backend)

Google login adds another way to authenticate the same BlogHub user. Email/password registration and login remain available. NestJS remains the owner of users, roles, permissions, access tokens, and refresh sessions. The frontend/Auth.js integration is not implemented yet.

## Configuration and database

Set this optional value in local `.env`:

```dotenv
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

Use the same web OAuth client ID that the future Next.js Auth.js Google provider uses. It is an audience identifier, not the Google client secret. The client secret belongs on the Next.js server only. NestJS verifies Google tokens using Google's public keys through `google-auth-library`; no Google client secret is needed here. Missing configuration returns 503 on Google routes without preventing local login or server startup.

The new `auth_accounts` table contains:

- `id`: UUID.
- `user_id`: application user; foreign key with cascade on user deletion.
- `provider`: `google` for this implementation.
- `provider_account_id`: Google's stable `sub`, not its email address.
- `created_at`: link timestamp.

Unique indexes prevent the same Google identity belonging to multiple users and prevent multiple Google identities being attached to one user. `users.password_hash` is now nullable. Existing passwords are preserved. Password hashes, provider identities, and Google tokens are not added to user profile responses. Raw Google tokens are not stored.

The existing development `synchronize: true` setup creates the table and updates nullability when the backend restarts. For an existing database where synchronization is disabled, an incremental TypeORM migration is provided:

```bash
npm run migration:run
```

Run from the repository root with `DB_*` values set locally, including `DB_PORT`. This migration assumes BlogHub's existing `users` table exists; it is not a baseline migration for a fresh database. It can also be recorded after development synchronization has created the same table/indexes. It does not change existing users or passwords. Its rollback refuses to restore NOT NULL while passwordless accounts exist. The migration command does not run automatically; the implementation did not apply it to your application database.

## Google login or registration

```text
POST http://localhost:5300/api/v1/auth/google
Origin: http://localhost:3000
Content-Type: application/json
```

The Origin must match `FRONTEND_ORIGINS`, just as with password login.

```json
{
  "idToken": "<real-Google-ID-token-from-Auth.js>"
}
```

Do not send `email`, `name`, `role`, `userId`, a Google access token, or an Auth.js session token. Additional fields return 400. The ID token is verified for signature, issuer, audience, and expiry. A nonempty subject and verified email are required. Plain decoded JWT contents are not trusted.

Account resolution is deliberately explicit:

1. If `google` + verified `sub` is already linked, sign in that application user. The link remains authoritative even if their Google or application email later changes; no automatic email updates or account reassignment occur.
2. If there is no link and no matching normalized email, create an active author with no password, link Google, and create a normal BlogHub session in one transaction.
3. If there is no link but the email exists, return 409. Do not create a duplicate user or automatically merge accounts.
4. Disabled linked users cannot sign in. Linking does not enable disabled accounts or change roles.

The existing-email response is:

```json
{
  "code": "GOOGLE_LINK_REQUIRED",
  "message": "Sign in with your existing password, then link Google to your account."
}
```

Success returns HTTP 200:

```json
{
  "accessToken": "<BlogHub-access-JWT>",
  "expiresIn": 3600
}
```

The response also sets the existing `bloghub_refresh` HttpOnly cookie, with the same path, SameSite, Secure policy, and seven-day absolute lifetime as password login. The refresh token is not returned in JSON.

Google login permits ten requests per minute per IP. A simultaneous first login can return 409 if another request creates the same user or link first. Retry login; database constraints and transaction rollback ensure no duplicate/partial account is kept.

## Link an existing account safely

First use existing `POST /auth/login` with email/password. Then:

```text
POST http://localhost:5300/api/v1/auth/google/link
Authorization: Bearer <BlogHub-access-token>
Content-Type: application/json
```

```json
{
  "idToken": "<real-Google-ID-token-for-the-same-email>",
  "currentPassword": "<current-BlogHub-password>"
}
```

Both a valid BlogHub session and current password are required. The Google identity is independently verified, and its normalized email must match the signed-in account for a new link. No supplied user ID is accepted. This prevents matching email alone from granting access to an existing account, including an admin account.

HTTP 200:

```json
{
  "message": "Google account linked successfully"
}
```

Linking keeps the existing ID, password, display name, role, content, and sessions. It does not create another session or set a cookie. Retrying the same link after password proof succeeds without adding another row. Linking a Google identity owned by someone else, or a second Google identity to the same user, returns 409. Linking permits five requests per minute per IP. This Bearer route does not require Origin.

Once linked, either login method reaches the same application account. There is no unlink endpoint in this scope. If the existing password is forgotten, recover it through the current verified email-code flow before linking.

## Passwordless account behavior

- Local registration still requires a password.
- Google-created accounts have `password_hash = NULL`; no fake/random password is assigned.
- Password login and current-password changes return 401 for such accounts, rather than passing null to bcrypt.
- Display-name editing works normally. Email editing still requires a current local password.
- A Google-only user can use the existing forgot-password/reset-password email-code flow to establish a password. After that, password login, password changes, and email edits work normally. Password reset revokes existing sessions just as before, but retains the Google link.

## Frontend integration contract (next stage)

1. Auth.js handles the Google OAuth redirect/callback with its OAuth state/nonce/PKCE protections as applicable.
2. Next.js server code gets Google's `account.id_token` and calls NestJS `/auth/google` over HTTPS in production. Supply the configured frontend Origin. Do not use an arbitrary email received from the browser.
3. Use a Next.js Server Action or response handler to explicitly copy the backend refresh cookie into the frontend response, following the existing authentication Server Action. A server-side fetch does not automatically set browser cookies. Do not assume an Auth.js callback alone can write the application's browser cookie.
4. Load the existing application session and `/auth/me`. Continue sending BlogHub Bearer tokens to protected endpoints; renew through existing `/auth/refresh`.
5. On `GOOGLE_LINK_REQUIRED`, require password sign-in and confirmation, then call `/auth/google/link` with that user's Bearer token and the verified Google ID token.
6. Never expose the Google ID token, Google client secret, or application refresh token in client-readable Auth.js session JSON, query strings, or logs. Protect the frontend bridge from CSRF and arbitrary redirects. Origin checks alone are not proof of a server-to-server caller; the signed Google token is the backend's identity proof.
7. Keep the backend session as the application's authority. Auth.js state must not silently recreate a session after logout, password reset, or account disable. Clear temporary Auth.js sign-in state on logout. Do not exchange the same Google ID token on every session read or refresh.

Google ID tokens are bearer credentials and can be reused until expiry if stolen. Keep them server-side during the handoff and discard them once the application session is established. There is no custom Google token replay database or Google API/offline-access integration in this version.

## Postman and verification

You can test the request format now, but successful Google authentication requires a real Google OAuth ID token issued for `GOOGLE_CLIENT_ID`. Plain email, an invented JWT, or your existing BlogHub JWT will not work. The Auth.js frontend that obtains this token is the next stage.

| Check                                                          | Expected                                         |
| -------------------------------------------------------------- | ------------------------------------------------ |
| Missing Google configuration                                   | 503 on Google routes only                        |
| Missing/disallowed Origin on Google login                      | 403                                              |
| Missing ID token, extra identity/role fields                   | 400                                              |
| Invalid/expired token, wrong audience/issuer, unverified email | 401                                              |
| Existing email without provider link                           | 409, `GOOGLE_LINK_REQUIRED`                      |
| Link without BlogHub Bearer token                              | 401                                              |
| Link with incorrect password                                   | 401                                              |
| New link with a different email                                | 400                                              |
| Google identity already linked elsewhere                       | 409                                              |
| Disabled linked account                                        | 401                                              |
| Successful Google login                                        | 200, normal access JWT + HttpOnly refresh cookie |

Run:

```bash
npm test
npm run lint
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/auth/google-auth.postgres.spec.ts
```

The normal suite includes local RSA-signed token fixtures exercising Google's real signature/audience/issuer/expiry verifier without network calls. Service checks cover safe linking, passwordless accounts, uniqueness errors, and shared session issuance. Opt-in PostgreSQL/HTTP checks use a random temporary schema, mock Google identity and SMTP only, and exercise real guards, cookies, transactions, registration/password login, refresh/logout, password recovery, duplicate races, and the migration. They never use real Google credentials or send email. They do not modify application tables. Actual Google OAuth sign-in must still be tested when the frontend is connected.

## Where the code lives

| File                                                         | Responsibility                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `src/auth/google-token.service.ts`                           | Verify Google tokens with the official library             |
| `src/auth/entities/auth-account.entity.ts`                   | Provider-to-application-user relationship                  |
| `src/auth/dto/google-login.dto.ts`                           | Google login input validation                              |
| `src/auth/dto/link-google.dto.ts`                            | Link input, including current password                     |
| `src/auth/auth.controller.ts`                                | Two routes, guards/rate limits, login cookie               |
| `src/auth/auth.service.ts`                                   | Account resolution, linking, shared `createSession` helper |
| `src/auth/auth.repository.ts`                                | Lookup an existing Google provider identity                |
| `src/auth/auth.module.ts`                                    | Register entity and verifier                               |
| `src/users/entities/user.entity.ts`                          | Nullable password hash                                     |
| `src/users/users.repository.ts`                              | Safe password check for profile email changes              |
| `src/database/migrations/1792454400000-AddGoogleAccounts.ts` | Incremental database change                                |
| `src/database/data-source.ts`                                | Explicit migration CLI connection                          |

The feature stays in Auth. No separate Google module, generic authentication abstraction, or unrelated refactor was added.
