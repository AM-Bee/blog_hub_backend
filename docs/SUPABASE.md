# Supabase database setup

NestJS connects to Supabase PostgreSQL through TypeORM. Existing authentication,
roles, API endpoints, and Socket.IO remain in the backend. New blog images use
Supabase Storage; bucket/key setup is documented in [IMAGES.md](IMAGES.md).
Previously uploaded local files are not copied automatically.

## Connection

Disable the Supabase Data API before creating application tables. The frontend
uses NestJS endpoints; a Supabase publishable key is not a database password.

Choose **Connect → Session pooler** in the Supabase dashboard. Put its connection
details in the backend `.env`:

```env
DB_HOST=your-pooler-host.pooler.supabase.com
DB_PORT=5432
DB_USERNAME=postgres.your-project-ref
DB_PASSWORD="your-project-database-password"
DB_NAME=postgres
DB_SSL=true
DB_SSL_CA_FILE=certs/supabase-ca.crt
```

The CA certificate downloaded from Supabase is in `certs/supabase-ca.crt`.
It is a public certificate, not a private key. TLS certificate and hostname
verification remain enabled. Paths are relative to the backend working directory.
Deploy the certificate with the backend when deploying to another server.

The application, migration runner, demo seed, and admin seed use these SSL settings.
For local PostgreSQL, set `DB_SSL=false`.

## Create the schema

```bash
npm run migration:run
```

Schema synchronization is disabled for application startup. Run migrations before
starting the backend, both locally and in production.

The initial migration creates seven core tables: users, categories, tags, blogs,
blog_tags, refresh_sessions, and refresh_tokens. The following five migrations
add Google accounts, audit logs, notifications, chat tables/triggers, and message
deletion. A fresh database ends with 12 application tables and a `migrations`
tracking table. UUID defaults use PostgreSQL's built-in `gen_random_uuid()`.

The initial migration skips creation if all seven core tables already exist.
It refuses a partial core schema rather than modifying it. It does not import
old records or repair older schema differences. Automatic rollback of the initial
migration is refused because existing installations may already contain user data.

## Create an admin and start

Set `ADMIN_EMAIL`, `ADMIN_DISPLAY_NAME`, and `ADMIN_PASSWORD` privately in `.env`, then:

```bash
npm run seed:admin
npm run start
```

The old local database is left untouched. Existing local records are not copied.
The new database starts empty; old login sessions do not work against it.
The optional demo seed is separate and uses known demo credentials; do not run it
on a publicly accessible deployment.

## Migration verification

```bash
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/database/migrations/initial-schema.spec.ts
```

The database test uses a unique temporary schema, runs all migrations, checks
entity alignment and chat constraints, verifies reruns preserve records, and
removes only that schema afterward. It never resets the application schema.
