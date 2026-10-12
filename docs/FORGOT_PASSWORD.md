# Forgot password: email verification

Email verification is used only for forgot password. Registration, profile editing, login, and signed-in password changes do not send verification emails.

The email supplied to forgot-password must already belong to a BlogHub account. Codes go to that registered address. To test with `nimo.arrmann123@gmail.com`, use a BlogHub account registered with that address. It is not a global destination or the automatically configured sender.

## Configure email delivery

Copy these settings from `.env.example` into your local `.env`, then fill in your sending account:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-sending-account@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=your-sending-account@gmail.com
```

For Gmail, enable 2-Step Verification and create an [app password](https://support.google.com/accounts/answer/185833). Use that app password here, not your normal Google password. App passwords may be unavailable for some accounts; another SMTP provider can be configured using the same settings. Keep credentials local and never commit `.env`.

Mail uses [Nodemailer SMTP](https://nodemailer.com/smtp), TLS on port 465 or required STARTTLS on other ports. No email is sent just by starting the server.

Restart with `npm run start:dev`. The current development setup uses TypeORM `synchronize: true`, which adds three reset fields to `users` on startup: `password_reset_code_hash`, `password_reset_expires_at`, and `password_reset_attempts`. No separate table is needed. Environments with synchronization disabled must add these columns through a migration before using the routes.

## Test in EchoAPI

Use raw JSON and `Content-Type: application/json`. Neither route requires a Bearer token, refresh cookie, or Origin header.

### 1. Request a code

`POST http://localhost:5300/api/v1/auth/forgot-password`

```json
{
  "email": "nimo.arrmann123@gmail.com"
}
```

Expected HTTP 200:

```json
{
  "message": "If this email is registered, a password reset code has been sent."
}
```

Check the registered email inbox/spam folder for the six-digit code. The response intentionally does not reveal whether an account exists and never returns the code. Requesting a code does not change the password or sign out sessions.

### 2. Verify the code and replace the password

`POST http://localhost:5300/api/v1/auth/reset-password`

```json
{
  "email": "nimo.arrmann123@gmail.com",
  "code": "123456",
  "newPassword": "NewPassword123!"
}
```

Replace `123456` with the emailed code. Send the code as a string to preserve leading zeroes. The new password must have at least eight characters and at most 72 UTF-8 bytes.

Expected HTTP 200:

```json
{
  "message": "Password reset successfully. Please log in again."
}
```

The old password, existing access tokens, and refresh sessions no longer work. Log in with the new password using the usual login route and allowed Origin header.

## Rules and troubleshooting

- Codes expire after 15 minutes and work once. Only their bcrypt hash is stored.
- Five incorrect attempts disable that code. Expired, used, incorrect, or disabled codes return HTTP 400 with `Invalid or expired reset code`.
- A new delivered code replaces the previous code. Wait at least 60 seconds between requests for the same account; earlier requests return the same generic response without sending another email.
- Forgot-password allows three requests per minute per IP; reset-password allows five. Exceeding these limits returns HTTP 429.
- Changing the account email or changing its password invalidates outstanding codes.
- Missing SMTP settings return HTTP 503. Delivery failures log a generic server error, preserve the previous code, and return the usual generic response. Check the SMTP settings and server logs if no message arrives. Codes and credentials are never logged.
- HTTP 404 means the running server may need restarting to load the new routes.

## Verification

Unit tests validate the DTOs and SMTP transport behavior with mocked delivery. PostgreSQL integration tests cover hashed storage, account privacy, resend cooldown, expiry, five-attempt lockout, one-time concurrent use, old-code invalidation, delivery failure, and session revocation. They use an isolated temporary schema and mocked email delivery; they do not send real emails.

```bash
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/users/account.postgres.spec.ts
```
