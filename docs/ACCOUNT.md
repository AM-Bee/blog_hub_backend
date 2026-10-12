# Profile editing and password changes

These endpoints work for authors and admins. They affect only the signed-in account; no user ID or role can be submitted. Swagger is at `/api/docs`.

Add this header in EchoAPI:

```text
Authorization: Bearer <accessToken>
Content-Type: application/json
```

These Bearer-authenticated routes do not require an Origin header. Login, refresh, and logout still require the configured frontend Origin.

## EchoAPI: start here

Restart the backend to load the new routes. Use a test account whose email and password you can change. The examples below use `account.test@example.com` and `OldPassword123!`; replace these with your own test credentials if needed.

For requests with a body, choose **Body → raw → JSON**. Use JSON, not form-data. Set `Content-Type: application/json` in Headers.

### 1. Register a test account (optional)

Skip this step if you already have an account to test.

```text
POST http://localhost:5300/api/v1/auth/register
```

```json
{
  "displayName": "Account Test",
  "email": "account.test@example.com",
  "password": "OldPassword123!"
}
```

Expected: **201**, with `{"message":"User Registered Successfully"}`. If this email already exists, use that account's current password or choose another test email.

### 2. Log in and copy the access token

```text
POST http://localhost:5300/api/v1/auth/login
```

Headers:

```text
Content-Type: application/json
Origin: http://localhost:3000
```

Use an Origin listed in your local `FRONTEND_ORIGINS` if yours differs.

```json
{
  "email": "account.test@example.com",
  "password": "OldPassword123!"
}
```

Expected: **200**:

```json
{
  "accessToken": "<your-access-token>",
  "expiresIn": 3600
}
```

Copy `accessToken`. In EchoAPI's **Auth** tab, select **Bearer Token** and paste only the token, without adding `Bearer` yourself. Alternatively, set `Authorization: Bearer <your-access-token>` in Headers. Use one method so there is only one Authorization header. Let EchoAPI keep the refresh cookie set by login.

### 3. Read your current profile

```text
GET http://localhost:5300/api/v1/auth/me
Authorization: Bearer <your-access-token>
```

Leave the body empty. Expected: **200**, with `id`, `displayName`, `email`, `role`, `createdAt`, and `updatedAt`. Passwords and password hashes are never included.

## Edit display name

```text
PATCH http://localhost:5300/api/v1/auth/me
```

```json
{ "displayName": "Bee Writer" }
```

Use the Bearer token from login and the JSON Content-Type header. Expected: **200**, with the updated profile. Call `GET /api/v1/auth/me` again to confirm `displayName` is `Bee Writer`.

Names are trimmed and must contain 1–100 characters. Omitted fields remain unchanged. An empty update is rejected. The response contains the updated safe profile: ID, display name, email, role, and timestamps.

## Edit email

Use the same PATCH route:

```json
{
  "email": "account.updated@example.com",
  "currentPassword": "OldPassword123!"
}
```

Expected: **200**, with `email: "account.updated@example.com"`. Confirm with `GET /api/v1/auth/me`. Use an unused email address. You can keep using the same Bearer token after this update.

You can include `displayName` in the same request. Email is trimmed, lowercased, validated, and must be unique. A different email requires the current password; retaining the existing normalized email does not. After changing email, use the new email for future logins. Current sessions remain active. Email verification is not included.

Invalid input or attempts to change role, ID, password, or password hash through this route return 400. An incorrect/missing current password for an email change returns 401. Duplicate email returns 409. A failed update leaves both name and email unchanged.

## Change password

```text
POST http://localhost:5300/api/v1/auth/change-password
```

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

The new password must be at least eight characters and at most 72 UTF-8 bytes. Password whitespace is preserved. An incorrect current password returns 401; invalid input returns 400. This route allows five requests per IP per minute.

Success returns status 200:

```json
{ "message": "Password changed successfully. Please log in again." }
```

The password is bcrypt-hashed and stored in place of the old hash. All sessions belonging to that account are revoked, including the current one, and the browser refresh cookie is cleared. Existing access tokens and refresh tokens stop working. Other users' sessions are preserved.

The frontend should clear its stored access token and send the user to login. Do not attempt to refresh an old session after a successful password change. Login with the new password creates a new session.

## EchoAPI: confirm the password change

Perform these checks after the successful password change:

1. Call `GET /api/v1/auth/me` using the **old access token**. Expected: **401**, because its session was revoked.
2. Call `POST /api/v1/auth/login` with `account.updated@example.com` and `OldPassword123!`, including the Origin header. Expected: **401**, `Invalid email or password`.
3. Log in again using the updated email and the new password:

```json
{
  "email": "account.updated@example.com",
  "password": "NewPassword123!"
}
```

Expected: **200**, with a new `accessToken`. Replace the old token in EchoAPI's Auth tab, then call `GET /api/v1/auth/me` again. Expected: **200**, with the updated display name and email.

If you skipped the email update, use your unchanged email for these login checks. The old email cannot be used to log in after an email change.

## Negative checks and troubleshooting

Run password-change failure checks while you still have a valid token, before a successful password change signs you out. Each request counts toward the rate limit, including failed requests.

| Check                                                                | Expected result                                |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| Omit the Bearer token on profile/password routes                     | 401                                            |
| Send `{}` to PATCH `/auth/me`                                        | 400                                            |
| Change email without `currentPassword`, or with the wrong password   | 401                                            |
| Change email to another account's email using the correct password   | 409                                            |
| Send `role`, `id`, `password`, or `passwordHash` in a profile update | 400                                            |
| Send a blank display name or invalid email                           | 400                                            |
| Change password with an incorrect `currentPassword`                  | 401; password and sessions remain unchanged    |
| Send `newPassword: "short"`                                          | 400                                            |
| Exceed five password-change requests in one minute from the same IP  | 429; wait for the rate-limit window to reset   |
| Login without an allowed Origin                                      | 403; add an Origin matching `FRONTEND_ORIGINS` |
| New route returns 404                                                | Restart the backend and check method/path      |

These operations always apply to the account identified by the token, including admin accounts. There is no user ID in the URL or request body.

## Scope and verification

Forgot-password now uses an emailed verification code. See [FORGOT_PASSWORD.md](FORGOT_PASSWORD.md) for SMTP setup and EchoAPI examples. Profile editing and signed-in password changes do not send emails.

```bash
npm test
BLOGHUB_RUN_DB_TESTS=1 npm test
```

The PostgreSQL checks create and remove an isolated temporary schema using local `.env` credentials. Existing application tables are preserved. Checks cover duplicate emails, current-password verification, hashed password replacement, session revocation, and concurrent password changes.
