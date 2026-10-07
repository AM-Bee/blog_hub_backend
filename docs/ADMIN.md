# Create the first BlogHub admin

Add these values to your local `.env`:

```dotenv
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_DISPLAY_NAME=BlogHub Admin
ADMIN_PASSWORD=your-chosen-password
```

The password must contain at least eight characters and must not exceed 72 UTF-8 bytes. Keep it in `.env`, which is ignored by Git, rather than sharing it in chat or committing it. Quote dotenv values if they contain spaces or `#`.

Using your existing PostgreSQL connection settings, run:

```bash
npm run seed:admin
```

The command validates the configuration, normalizes the email, hashes the password with bcrypt, and creates a user with role `admin`. The users table must already exist. No running API, JWT secret, or application build is needed for this command.

Rerunning for an existing admin leaves their password and profile unchanged. An email belonging to an author is rejected; authors are never silently promoted. Existing accounts and other database tables are not modified.

Log in through `POST /api/v1/auth/login` using this email/password. With EchoAPI, include `Origin: http://localhost:3000` (or your configured frontend origin). Use the returned access token as `Authorization: Bearer <accessToken>` for admin actions. `GET /api/v1/auth/me` will return `role: admin`.

Remove `ADMIN_PASSWORD` from `.env` after successful creation if you no longer need to provision an admin. Public registration continues to create authors only.
