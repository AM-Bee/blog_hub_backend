# Private chat backend — database, REST, and Socket.IO

Study the source file by file and function by function: [CHAT_STUDY_GUIDE.md](CHAT_STUDY_GUIDE.md).

All four backend phases are complete (Phase 4 final review: [CHAT_PHASE4_REVIEW.md](CHAT_PHASE4_REVIEW.md)): database, protected REST API, and authenticated Socket.IO messaging. ChatModule reuses the existing JWT/session authentication. No frontend code, Redis, queues, or additional authentication system is included.

## Existing backend integration

- `src/auth/guards/jwt-auth.guard.ts` extracts the application Bearer JWT. `AuthService.authenticate()` verifies its signature/issuer/audience/expiry, checks the database refresh session, and loads the active application user. Access tokens last one hour; refresh sessions have a seven-day absolute lifetime. Chat REST routes reuse this authentication and user identity, including Google-linked users.
- The existing user table/entity is `users` / `src/users/entities/user.entity.ts`. It uses UUID primary keys, so chat IDs and participant IDs are UUIDs too. Integer IDs in initial examples must be replaced with real UUIDs.
- `src/database/database.module.ts` configures PostgreSQL with ConfigService and the existing `DB_*` settings. `DB_PORT` falls back to 5433; set it explicitly in `.env`.
- `src/database/data-source.ts` and `npm run migration:run` provide the existing incremental migration path.
- Later phases can reuse `AuthModule`, `JwtAuthGuard`, `AuthService.authenticate()`, `frontendOrigins()`, and the existing DTO validation helpers and Nest exceptions. No second authentication system is needed.
- Socket.IO, `@nestjs/websockets`, and `@nestjs/platform-socket.io` provide the gateway. `socket.io-client` is a development dependency for real socket tests.

## Conversation entity

File: `src/chat/entities/conversation.entity.ts`. Table: `chat_conversations`.

| Field       | PostgreSQL column        | Meaning                            |
| ----------- | ------------------------ | ---------------------------------- |
| `id`        | `id` UUID                | Conversation identifier            |
| `user1Id`   | `user1_id` UUID          | First user in the normalized pair  |
| `user2Id`   | `user2_id` UUID          | Second user in the normalized pair |
| `createdAt` | `created_at` timestamptz | Creation time                      |
| `updatedAt` | `updated_at` timestamptz | Most recent conversation update    |

Both participants reference existing `users` rows. Each user can participate in many conversations, and each conversation has many messages.

The entity's `@BeforeInsert` method lowercases and sorts the two UUID strings. TypeORM `save(repository.create(...))` therefore produces the same pair for A/B and B/A. This is normalization, not a database lookup; The repository finds/returns an existing pair and handles concurrent insert conflicts.

PostgreSQL independently requires `user1_id < user2_id`:

- Equal IDs fail, so users cannot chat with themselves.
- A direct SQL insert must use canonical order. Raw SQL and plain-object bulk inserts do not rely on the entity listener.
- A unique index on `(user1_id, user2_id)` prevents a second conversation for the same pair, including simultaneous inserts.

Participants cannot be changed after creation. A database trigger rejects attempts to replace them. This avoids reassigning private conversation history to a different user and keeps message membership valid. Updating `updatedAt` remains allowed.

Two indexes support looking up conversations by either participant, with update time and ID as ordering fields. `updatedAt` is updated by TypeORM when the conversation is updated; the message-saving transaction explicitly updates it when a new message is stored. Retrying an existing message does not change the conversation timestamp.

## Message entity

File: `src/chat/entities/message.entity.ts`. Table: `chat_messages`.

| Field             | PostgreSQL column        | Meaning                                         |
| ----------------- | ------------------------ | ----------------------------------------------- |
| `id`              | `id` UUID                | Server-generated message identifier             |
| `conversationId`  | `conversation_id` UUID   | The conversation containing the message         |
| `senderId`        | `sender_id` UUID         | Existing user who sent it                       |
| `clientMessageId` | `client_message_id` UUID | Client request identifier for safe retries      |
| `content`         | `content` varchar(2000)  | Plain text, maximum 2,000 PostgreSQL characters |
| `isRead`          | `is_read` boolean        | Defaults to false                               |
| `createdAt`       | `created_at` timestamptz | Message creation time                           |

A message references one conversation and one sender. A conversation can contain many messages, and a user can send many messages. Content is stored as text without HTML rendering. A check rejects empty strings and content containing only PostgreSQL whitespace characters (including spaces, tabs, and newlines). The varchar limit rejects text longer than 2,000 characters.

A unique index on `(sender_id, client_message_id)` ensures one sender cannot create a second message with the same retry ID, even in another conversation. Different senders can independently use the same UUID. The repository looks up the existing message on a retry, verifies the conversation and payload agree, and returns it without emitting a duplicate event.

The history index covers `(conversation_id, created_at, id)` for stable pagination in either direction. Another index covers `(conversation_id, is_read, sender_id)` for unread counts/read updates.

## Why the migration has triggers

File: `src/database/migrations/1792584000000-AddPrivateChat.ts`.

A normal sender foreign key only proves that the sender exists in `users`. It does not prove that the sender is one of this conversation's two participants. A PostgreSQL CHECK cannot directly check another table, so the migration adds one small membership trigger:

- Before inserting a message or changing its sender/conversation, check the conversation's participants.
- Reject an outsider with a constraint error.
- Missing conversations/senders remain invalid through the foreign keys.

A second trigger keeps conversation participants fixed. Without it, someone writing directly to the database could change a conversation after its messages had been validated, making its old senders invalid or exposing its history to a new participant.

These are database-integrity rules, not replacements for API authorization. REST routes verify membership for conversation/history reads and derive identity from the verified session. The gateway authorizes every socket operation as well. Message sending and read updates use socket events; no extra REST mutation routes were added.

The membership function binds its conversation lookup to the migration's schema, so it also works when tests use a separate schema and later queries run on different database connections.

## Deletion rules

- Deleting a conversation cascades to its messages.
- Deleting a participant/sender is restricted while related conversations/messages exist. There is currently no account-deletion endpoint; a future retention/deletion policy can change this deliberately.
- No conversation/message deletion endpoint is added in Phase 1.

## Schema synchronization and production

Both chat entities have `synchronize: false`. Their schema must be created through the migration in every environment, including development, because automatic TypeORM synchronization does not create these trigger functions.

ChatModule now registers both entities, keeping their migration-managed options. The migration creates real PostgreSQL tables independently of module registration.

Existing development modules retain their current synchronization behavior. Application schema synchronization is now disabled when `NODE_ENV=production`. Set that environment value for production; never run a production deployment using the development `.env` settings. Migration commands themselves always use `synchronize: false`.

## Run the migration

Use your existing local `.env` database values. The existing `users` table must already exist. From the backend repository root:

```bash
npm run migration:run
```

This compiles the backend and runs all pending registered migrations in order, including Google accounts, audit logs, notifications, and private chat when they have not yet been recorded. TypeORM records successful migrations so the same command does not repeatedly apply them. This is an incremental migration chain, not a baseline for a completely empty production database.

Unlike the older development features, **`npm run start` alone does not create the chat tables**. Run the migration first. It adds the two chat tables, foreign keys, checks, indexes, and triggers without deleting existing users or application data. The implementation verifies the migration only in a temporary test schema; it does not apply it to your application database automatically.

`up()` adds the schema. `down()` removes the messages table first, then conversations, then both trigger functions. Reverting would remove stored chat history. No rollback command is run by this implementation.

## Verify in PostgreSQL

After running the migration, use your PostgreSQL client against the same configured database. The examples assume the standard `public` schema.

Check tables:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('chat_conversations', 'chat_messages')
ORDER BY table_name;
```

Check foreign keys and CHECK constraints:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN (
  'public.chat_conversations'::regclass,
  'public.chat_messages'::regclass
)
ORDER BY conname;
```

Check indexes, including the unique pair and sender/retry indexes:

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('chat_conversations', 'chat_messages')
ORDER BY tablename, indexname;
```

Check both application triggers:

```sql
SELECT event_object_table, trigger_name, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('chat_conversations', 'chat_messages')
ORDER BY event_object_table, trigger_name, event_manipulation;
```

PostgreSQL reports one row per trigger event, so a trigger handling INSERT and UPDATE appears more than once. In psql, `\d public.chat_conversations` and `\d public.chat_messages` also display columns, indexes, constraints, and triggers.

## REST endpoints (Phase 2)

Base URL: `http://localhost:5300/api/v1`. Every chat route requires `Authorization: Bearer <access-token>`. Use the existing login endpoint to obtain a token. Admins have the same chat membership restrictions as authors; roles do not grant access to other users' conversations.

| Method | Path                                               | Behavior                                                                      |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/chat/conversations`                              | Find or create one conversation with a recipient; returns 200 for either case |
| GET    | `/chat/conversations?page=1&limit=20`              | List only your conversations, most recently updated first                     |
| GET    | `/chat/conversations/:id/messages?page=1&limit=20` | Read history only if you are a participant                                    |

POST body:

```json
{ "recipientId": "another-users-real-uuid" }
```

The sender comes from the authenticated request. Unknown properties such as `senderId` are rejected. Recipient IDs must be UUIDs; missing recipients return 404 and self-conversations return 400. Repeating the request, reversing the pair, or starting simultaneously returns the same conversation. The database unique index remains the final protection against duplicates.

Example conversation response (IDs below are illustrative):

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "otherUser": {
    "id": "22222222-2222-4222-8222-222222222222",
    "displayName": "Bob"
  },
  "lastMessage": null,
  "unreadCount": 0,
  "createdAt": "2026-10-21T00:00:00.000Z",
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

Both GET routes return `{ items, page, limit, total, totalPages }`. Defaults: page 1 and limit 20. Page must be an integer from 1 to 1,000,000; limit must be an integer from 1 to 50. Invalid values and unknown query parameters return 400. Empty and beyond-last pages return `items: []`; an empty collection has `totalPages: 0`.

Conversation responses expose only the other user's ID/display name, a safe last-message object, and the signed-in recipient's unread count. A last-message object has `id`, `conversationId`, `senderId`, `clientMessageId`, `content`, `isRead`, and `createdAt`. Its `createdAt` is the last-message timestamp; when no message exists, `lastMessage` is null. User emails, credentials, sessions, and provider information are excluded. The repository batches users, latest messages (PostgreSQL DISTINCT ON), and unread counts for the whole page instead of querying each conversation separately.

History returns messages **newest first**, ordered by `createdAt DESC, id DESC`, including a deterministic ID tie-breaker for equal timestamps. Page 1 contains the newest messages; higher pages contain older messages. The frontend may reverse each page for display, but the API order remains newest first. Offset pagination is not a frozen snapshot: newly inserted messages can shift page boundaries. Fetching history does not mark messages as read. Content is plain text and must be rendered as text, not trusted HTML.

A nonexistent conversation returns 404. An existing conversation requested by a nonparticipant returns 403, including for admins. Invalid UUID path parameters return 400. Missing, malformed, expired, or session-revoked credentials and disabled users return 401 through the existing guard.

## Postman walkthrough

1. Log in as user A using `POST /auth/login` with the existing Origin header and email/password. Copy the returned access token into Postman's Bearer Token authorization. You need a second registered user B and its real user UUID.
2. Send `POST /chat/conversations` with B's ID. Save the returned conversation ID. Expect 200, B's public profile, `lastMessage: null`, and `unreadCount: 0` for a new conversation.
3. Send the same POST again. Expect the same conversation ID.
4. Send `GET /chat/conversations?page=1&limit=20`. Expect that conversation in `items`.
5. Send `GET /chat/conversations/<conversation-id>/messages?page=1&limit=20`. A new conversation returns an empty page until a message is sent through Socket.IO.
6. Log in as B and retrieve the same history. It should succeed. B's conversation list shows A as `otherUser`.
7. Log in as a third user C and request A/B's history. Expect 403. C's conversation list must not include A/B's conversation.
8. Remove authorization and repeat any chat request. Expect 401. Test your own recipient ID (400), an unknown UUID (404), and `limit=51` (400).

Swagger documentation is available at `http://localhost:5300/api/docs`, under the `chat` tag. Opening a URL in a browser sends GET; use Postman or Swagger for POST.

## Code responsibilities

- `chat.module.ts`: registers AuthModule, the entities, controller, service, repository, and gateway. AppModule imports ChatModule.
- `chat.controller.ts`: three protected REST routes, UUID parsing, DTO validation, and Swagger documentation.
- `chat.service.ts`: thin entry points delegating to the repository; conversation creation then formats its result.
- `chat.repository.ts`: find/create with duplicate-conflict handling, membership checks, paginated queries, batched conversation summaries, safe response mapping, atomic retry-safe message insertion, and recipient-only read updates.
- `dto/create-conversation.dto.ts`: recipient UUID validation.
- `dto/list-conversations-query.dto.ts` and `dto/list-messages-query.dto.ts`: bounded pagination validation.
- Response DTOs document individual and paginated conversations/messages. Repository return types reuse these shapes without adding extra abstraction layers.
- `chat.gateway.ts`: connection authentication, expiry/session checks, private delivery, event handlers, acknowledgements, and in-memory user rate limits.
- `interface/chat-ack.interface.ts` and `interface/chat-event.interface.ts`: typed acknowledgements, messages, read receipts, and typing payloads.
- `dto/send-message.dto.ts` and `dto/conversation-event.dto.ts`: socket payload validation.
- `chat.gateway.spec.ts`: timer, authorization, validation, event, and rate-limit unit tests.
- `chat.postgres.spec.ts`: real PostgreSQL + HTTP + Socket.IO tests, real login/JWT/session checks, isolated schema and cleanup.
- `src/common/taxonomy.modules.spec.ts`: existing module/Swagger wiring check now includes chat.

## Socket.IO (Phase 3)

Connect to namespace **`http://localhost:5300/chat`**, using Socket.IO with `transports: ['websocket']`. The transport path stays `/socket.io`; `/chat` is the namespace, not an HTTP route or a replacement transport path. REST's `/api/v1` prefix does not apply to Socket.IO. A plain WebSocket client or a GET in the address bar is not a Socket.IO client. Swagger documents REST only; socket events are documented here.

Connection authentication payload:

```json
{ "accessToken": "your-application-access-token" }
```

The token is the existing NestJS application access token, including for Google-linked users. Do not send Google tokens, refresh tokens, user IDs, or tokens in URL query strings. The client must keep secrets out of logs. No Google client secret or SMTP credential is needed for chat.

The gateway verifies the token/session/account before accepting the namespace connection, then joins the socket to server-controlled `user:<verified-user-id>`. Multiple tabs/devices of the same user join the same room. There is no client-controlled room-join event. Browser Origin must match `FRONTEND_ORIGINS`; clients without Origin still require authentication. Both the Socket.IO CORS callback and namespace handshake check use this existing configuration.

Each incoming event rechecks credentials before processing its operation. Each recipient socket is rechecked before private delivery, so revoked/expired recipients do not receive content between timer ticks. Idle connections are disconnected at the JWT expiry deadline. Session revocation or account disabling is detected by the next event, attempted private delivery, or periodic check (at most about 30 seconds for idle connections, subject to database/network latency). After expiry, use the existing HTTP refresh endpoint and reconnect with the new access token. The gateway does not refresh tokens automatically or reset their lifetimes.

Connection failures appear as Socket.IO `connect_error` with a safe message. If authentication is lost after connecting, the server disconnects the socket; an event acknowledgement may not arrive before that disconnect. Clients must handle `disconnect` and acknowledgement timeouts, then authenticate/reconnect as appropriate.

### Events and acknowledgements

All incoming event payloads must be JSON objects. UUIDs, content, and extra properties are validated. All event handlers return either:

```json
{ "ok": true, "data": {} }
```

or:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You are not a participant in this conversation"
  }
}
```

Error codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`. Validation errors may combine multiple messages with semicolons. Unexpected errors return a generic message without database details. The gateway does not log credentials or message content.

| Client event   | Payload                                        | Success acknowledgement `data`          | Recipient event                                                         |
| -------------- | ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `message:send` | `{ conversationId, clientMessageId, content }` | `{ message, created }`                  | `message:new` with the message object, only for newly inserted messages |
| `message:read` | `{ conversationId }`                           | `{ conversationId, readerId, updated }` | `message:read` with the receipt, only when at least one message changed |
| `typing:start` | `{ conversationId }`                           | `{ conversationId, userId }`            | `typing:start` with the same data                                       |
| `typing:stop`  | `{ conversationId }`                           | `{ conversationId, userId }`            | `typing:stop` with the same data                                        |

Every recipient event goes only to authenticated connections of the **other participant**. The initiating socket receives its acknowledgement rather than a duplicate `message:new` echo. Other sender devices can refresh history to synchronize their own sent messages. Typing events are temporary and never stored. Clients should clear typing indicators after a short local timeout as well as on `typing:stop`/disconnect.

Example send payload:

```json
{
  "conversationId": "11111111-1111-4111-8111-111111111111",
  "clientMessageId": "33333333-3333-4333-8333-333333333333",
  "content": "Hello!"
}
```

Generate `clientMessageId` once per intended message and reuse it with the exact same conversation and content on retries. Content is nonblank plain text, at most 2,000 characters. A new insert returns `created: true`. Retrying returns the original message with `created: false`, preserves its ID/timestamps, and emits no duplicate. Reusing the same sender/client ID with different content or another conversation returns `CONFLICT`. Different senders may use the same client ID independently.

The repository locks the conversation row and saves the message plus conversation timestamp in one transaction. PostgreSQL uniqueness handles concurrent retries. Failed timestamp updates roll back the message insertion. For read events, it locks the same row and updates only unread messages whose sender differs from the verified reader. Clients cannot choose `senderId`, `readerId`, or another identity; extra payload properties are rejected. Read receipts are a signal to refresh canonical message `isRead` flags; do not blindly mark later-arriving messages as read using only the receipt's count.

Socket delivery is best effort, not a durable queue or delivery acknowledgement. Committed messages remain available through REST history while the recipient is offline or disconnected. An event can be missed during a disconnect/server crash; reconnecting clients must fetch history. The retry guarantee prevents duplicate database rows and duplicate emission on repeated requests, but does not guarantee exactly-once delivery over the network.

### Rate limits and lifecycle

One in-memory fixed window per authenticated user allows **30 message-send attempts and 120 total chat-event attempts per 60 seconds**, shared across that user's connections. Invalid/retried attempts also consume the relevant quota. Reconnecting does not reset a window. Limits reset at the next window; exceeded requests return `RATE_LIMITED`. The maximum Socket.IO packet is 16 KiB, enough for 2,000 Unicode characters and identifiers. Larger packets may disconnect at the transport layer instead of returning an acknowledgement.

These counters and rooms are local to one backend process. Restarting resets counters, and multiple independent instances do not share limits or live delivery. Deploy this version as a single instance; distributed delivery/limits are a separate task. No Redis was added. Expired rate buckets and disconnected-socket timers are cleaned up, including on application shutdown.

### Try two clients

Use two registered users A and B. Create their conversation through REST, then connect a Socket.IO client for each user. A minimal example using `socket.io-client` is:

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:5300/chat', {
  transports: ['websocket'],
  auth: { accessToken: 'YOUR_NESTJS_ACCESS_TOKEN' },
});

socket.on('connect_error', (error) => console.log(error.message));
socket.on('disconnect', (reason) => console.log(reason));
socket.on('message:new', (message) => {
  // Render content as text. Do not render it as trusted HTML.
});
socket.on('message:read', (receipt) => {
  // Refresh the conversation's message read flags.
});
socket.on('typing:start', (event) => {});
socket.on('typing:stop', (event) => {});

// Run after the connection is established, when the user sends a message.
const payload = {
  conversationId: 'YOUR_CONVERSATION_UUID',
  clientMessageId: crypto.randomUUID(),
  content: 'Hello!',
};
socket.on('connect', () => {
  socket.timeout(5000).emit('message:send', payload, (error, ack) => {
    if (error) {
      // The outcome is unknown: retry the same payload after reconnecting.
      return;
    }
    // Check ack.ok before using ack.data.
  });
});
```

A sends a message and receives an acknowledgement; B's connections receive `message:new`. B emits `message:read` with the conversation ID; A receives a receipt. Then try typing events. Connect C and verify it cannot send/read/type in A/B's conversation. Do not publish real tokens or paste them into committed scripts. This example documents the client contract; no frontend files were created.

## Tests and remaining scope

```bash
npm test
npm run lint
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/chat/chat.postgres.spec.ts
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e
```

The normal suite includes 23 gateway tests covering expiry, periodic revocation checks, cleanup, safe errors, payload validation, private routing, duplicate suppression, typing/read events, and rate limits across tabs/reconnects. Module tests verify Nest dependency wiring and Bearer security on REST Swagger operations without PostgreSQL.

The opt-in chat suite contains 25 real PostgreSQL/REST/Socket.IO tests. It creates a random temporary schema, applies the chat migration there, and connects real Socket.IO clients to an ephemeral local port. Tests cover guarded REST behavior, concurrent pair reuse, pagination, recipient-only multi-tab delivery, outsider/admin denial, concurrent/sequential retries, content/identity validation, read receipts, typing, revocation, idle expiry, offline history recovery, refresh-cookie reconnection, disabled accounts, JWT issuer/audience checks, and transaction rollback. Cleanup disconnects clients, shuts down timers/server, and drops only the temporary schema. Application tables/accounts are unchanged; no emails are sent.

No additional migration is needed beyond the installed Phase 1 migration. Phase 4 completed the security/error review, fixed expiry during an authentication query, tested reconnects with real clients, and ran existing-feature regressions plus complete AppModule acceptance tests. See [CHAT_PHASE4_REVIEW.md](CHAT_PHASE4_REVIEW.md) for exact scope, results, commands, and operating limits. No frontend work was performed.
