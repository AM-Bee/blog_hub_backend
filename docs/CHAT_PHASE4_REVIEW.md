# Chat backend final review — Phase 4

Completed: 2026-10-21. Scope: the private 1-to-1 NestJS chat backend and regression checks against existing backend features. Tests used real Socket.IO clients and local PostgreSQL in disposable schemas; no frontend files or application records were changed.

## Issue found and fixed

`ChatGateway.authenticateSocket()` checked expiry before awaiting AuthService, but AuthService also queries the database. A token could expire or a socket could disconnect during that wait. The gateway now rechecks connection status and expiry immediately after authentication returns, before allowing the operation or private delivery.

Two new unit tests first reproduced the issue: an expired sender could proceed and a recipient could receive an event after expiry during the query. Both pass after the fix. No database migration or new dependency was needed for Phase 4.

## Verified behavior

| Area              | Evidence                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication    | Missing/invalid/expired tokens and incorrect issuer/audience are rejected; logout, session revocation, disabled users, and password changes invalidate socket credentials.                                                                                                                                                                                                               |
| Private access    | Every conversation operation checks membership. Outsider admins cannot read/send/type in another pair's conversation. Only the other participant's authenticated connections receive private events.                                                                                                                                                                                     |
| Retry safety      | Concurrent and sequential retries return one message, emit once, preserve timestamps, and reject changed content/conversations under the same sender/client ID.                                                                                                                                                                                                                          |
| Database writes   | Conversation uniqueness is protected by PostgreSQL; message insertion and conversation timestamp update commit together. A forced update failure rolls back the message.                                                                                                                                                                                                                 |
| Read status       | Only unread messages received by the authenticated reader change. Repeating the read changes zero rows; users cannot supply another reader identity.                                                                                                                                                                                                                                     |
| Validation        | Invalid IDs, non-object payloads, extra sender/reader properties, blank content, and oversized messages are rejected. The 2,000 Unicode-character boundary is tested.                                                                                                                                                                                                                    |
| Lifecycle         | Expiry deadlines, periodic session checks, disconnect/shutdown timer cleanup, and recipient reauthentication are tested.                                                                                                                                                                                                                                                                 |
| Reconnect         | Offline messages are recovered through history; live delivery resumes after reconnect. The existing HTTP refresh-cookie flow rotates the refresh cookie and supplies a new access token for reconnection.                                                                                                                                                                                |
| Rate limits       | Send and total-event quotas apply across tabs/reconnects and reset after the window. Tests use controlled clocks.                                                                                                                                                                                                                                                                        |
| Existing features | Full AppModule tests cover registration/login, profile updates, category/tag relationships, duplicate category names, blog ownership/moderation, publishing blocks, author search, category deletion preserving posts, audit logs, notifications, admin user management, and password change. Separate existing suites cover Google linking/refresh/reset and notification transactions. |
| Error handling    | Expected failures return typed acknowledgements; unexpected database details are hidden. Lost authentication disconnects the socket.                                                                                                                                                                                                                                                     |

## Test results

- Regular suite: **125 passed**, including **23 gateway tests**. Database suites are opt-in and skipped in this command.
- Isolated PostgreSQL suites: **45 passed** — chat **25**, Google authentication **9**, notifications **11**.
- Full AppModule acceptance: **3 passed**.
- TypeScript no-emit check, lint, Nest CLI build using **Node 22.20.0**, and Git whitespace check passed.

Commands:

```bash
npm test
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/chat/chat.postgres.spec.ts src/auth/google-auth.postgres.spec.ts src/notifications/notifications.postgres.spec.ts
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e
```

Run the Nest build with the working Node 22 runtime. The review used `/home/ams/.nvm/versions/node/v22.20.0/bin/node node_modules/@nestjs/cli/bin/nest.js build`.

The e2e test previously booted AppModule against its configured database. It now requires the database-test flag, overrides the application DataSource with a disposable schema, and cleans up sockets/server/schema. Existing user/auth tables are synchronized only inside that temporary schema; the chat migration runs there explicitly. SMTP and Google network verification are mocked in the relevant authentication regression suite; no real reset email or OAuth request is sent.

The acceptance suite loads AppModule and the API prefix/cookie parser required for its requests. It does not run the production `main.ts` bootstrap, a reverse proxy, a browser UI, or deployment infrastructure. Frontend acceptance will be needed once a chat frontend exists.

## Operating limits and completion

All four agreed backend phases are complete. The event contracts, client example, refresh/reconnect instructions, REST pagination, and error formats are in [CHAT.md](CHAT.md).

Keep the documented deployment model: one backend process, local in-memory rate limits/rooms, and the existing PostgreSQL database. Socket delivery is best effort; clients must load history after reconnecting and reuse client message IDs after an uncertain acknowledgement. Live delivery is not a durable queue or an exactly-once network guarantee. Use the existing trusted frontend origin configuration and application token/refresh flow. Production schema synchronization remains disabled and chat tables remain migration-managed.

No frontend, Redis, distributed adapter, queue, new migration, or extra authentication system was added during this review.
