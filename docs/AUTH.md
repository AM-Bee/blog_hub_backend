# BlogHub authentication

All paths are relative to `/api/v1`. Swagger documentation is at `/api/docs`.

## Local configuration

Keep your existing database settings in `.env`. Add `JWT_SECRET` (at least 32 random bytes) and `FRONTEND_ORIGINS` (defaults to `http://localhost:3000`). Generate the secret locally with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the output into `.env`; never commit it. `.env.example` lists the supported settings without real secrets. Use a Node.js runtime compatible with the installed Nest CLI; Node 24.15 or later in the Node 24 line is recommended.

The existing database setup still uses `synchronize: true`. Starting the application adds `refresh_sessions` and `refresh_tokens`. Migrations and removal of synchronization are a separate foundation task; do not use schema synchronization for production. This implementation has not applied database changes.

## API

| Method | Path | Request / response |
| --- | --- | --- |
| POST | `/auth/register` | `{ displayName, email, password }`; creates an author and returns a success message (201) |
| POST | `/auth/login` | `{ email, password }`; returns `{ accessToken, expiresIn: 900 }` and sets a refresh cookie (200) |
| POST | `/auth/refresh` | No body; reads and rotates the refresh cookie, returns a new access token (200) |
| POST | `/auth/logout` | No body; revokes only this session and clears the cookie (200) |
| GET | `/auth/me` | Bearer access token; returns the private account profile without credentials (200) |

Login, refresh, and logout require an `Origin` header matching `FRONTEND_ORIGINS`, including when testing with Postman/curl. Register accepts no role or password hash. Invalid credentials, tokens, or expired sessions return 401. Disallowed/missing cookie-operation origins return 403. Rate limits return 429: 10 registration/login requests per IP per minute, and 60 requests per IP per minute for each other Auth endpoint.

For Swagger's browser-based "Try it out", also include the API origin in `FRONTEND_ORIGINS`, for example `http://localhost:3000,http://localhost:5300` during local development.

There is no `/auth/logout-all` endpoint. Login accepts existing author or admin accounts; admin provisioning remains a separate step.

## Frontend use

Use `credentials: 'include'` for login, refresh, and logout. CORS allows only the configured frontend origins and permits credentials. Keep `accessToken` in memory and send `Authorization: Bearer <accessToken>` for `/auth/me` and future protected routes.

Refresh on page reload or after access-token expiry. Serialize refresh requests: refreshing twice with the same token is treated as reuse and revokes that session. Do not retry an old refresh token after a failed/lost rotation response; log in again.

Access JWTs expire after 15 minutes. Sessions expire seven days after login; rotation does not extend this lifetime. Logout and refresh-token reuse revoke the session, invalidating its access JWTs as well. Multiple logins create independent sessions.

The refresh cookie is HttpOnly, SameSite=Lax, scoped to `/api/v1/auth`, and Secure in production. Frontend/backend must be compatible same-site origins. Revisit this policy before selecting cross-site hosting.

## Database and guards

`refresh_sessions` holds the user, expiry, and revocation timestamp. `refresh_tokens` holds SHA-256 token hashes and rotation history; raw tokens never persist in the database. Refresh/logout lock the session row inside a transaction to serialize competing requests. Keep used token hashes until the session is removed so reuse remains detectable.

Use `@UseGuards(JwtAuthGuard)` for signed-in access. For admin routes, import `AuthModule` in the feature module and use `@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles(UserRole.ADMIN)`. Roles are read from the current database account rather than trusted from JWT claims.

Rate limiting uses process-local storage for local development; choose shared storage before deploying multiple API instances.
