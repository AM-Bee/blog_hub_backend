# Delete a chat message for everyone

The sender can delete their own message through Socket.IO. There is no time limit. Admins follow the same sender-only rule; being an admin does not grant access to other users' private messages.

## Apply the schema change first

From the backend folder, using the existing database configuration:

```bash
npm run migration:run
```

Then restart the backend. The implementation tests the migration only in disposable schemas; it does not run it on your application database.

New migration: `src/database/migrations/1793145600000-AddMessageDeletion.ts`.

It adds nullable `deleted_at`, allows nullable content, and changes the content check so:

- A live message has `deleted_at = NULL` and nonblank text.
- A deleted message has a deletion timestamp and `content = NULL`.

Existing messages keep their text, IDs, timestamps, and read flags. Chat entities remain migration-managed (`synchronize: false`), including in development. Keep the earlier migration too; the new one follows it rather than replacing it.

Rollback refuses to run when deleted messages exist because the removed text cannot be recovered. It does not invent replacement text or drop deletion history silently.

## Client event

Connect to the existing Socket.IO namespace `http://localhost:5300/chat` with your normal application access token, then emit **`message:delete`**:

```json
{
  "messageId": "the-message-uuid"
}
```

The server takes the user ID from the authenticated socket. Do not send a sender, recipient, or conversation ID; extra fields are rejected. It finds the conversation from the stored message, verifies membership, and then verifies that this user sent that message.

Success acknowledgement:

```json
{
  "ok": true,
  "data": {
    "messageId": "11111111-1111-4111-8111-111111111111",
    "conversationId": "22222222-2222-4222-8222-222222222222",
    "deletedAt": "2026-10-28T10:00:00.000Z"
  }
}
```

The first deletion also emits **`message:deleted`** with the same `data` object to **both participants' authorized connections**, including the initiating socket and the sender's other tabs/devices. The acknowledgement and notification are separate; a client may receive both and should apply the same deletion idempotently.

Repeating deletion succeeds with the original deletion time and emits no new deletion notification. Simultaneous deletions are serialized by the same conversation lock used for sends/read updates.

Errors use the existing `{ ok: false, error: { code, message } }` format:

| Situation                                                                    | Code                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------- |
| Invalid UUID, missing ID, non-object payload, or extra fields                | `BAD_REQUEST`                                |
| Message does not exist                                                       | `NOT_FOUND`                                  |
| User is outside the conversation, or is the recipient rather than the sender | `FORBIDDEN`                                  |
| Total chat-event quota exceeded                                              | `RATE_LIMITED`                               |
| Retrying a send whose message was deleted                                    | `CONFLICT`                                   |
| Unexpected failure                                                           | `INTERNAL_ERROR` with a safe generic message |

Invalid/expired/revoked credentials disconnect the socket through the existing authentication checks. A disconnect can prevent an error acknowledgement arriving, so handle disconnects and timeouts as usual. Deletion attempts count toward the shared 120-total-events-per-minute user quota.

## What history and unread counts show

The message row remains in history with its original ID, sender, creation time, and read flag. Its response now includes:

```json
{
  "content": null,
  "deletedAt": "2026-10-28T10:00:00.000Z"
}
```

Live messages have text and `deletedAt: null`. The frontend should display **“Message deleted”** when `deletedAt` is present. The backend does not return the removed text in new history/preview responses.

- Pagination totals still include deleted placeholders.
- If the latest message is deleted, the latest-message preview becomes its placeholder.
- Deleted messages do not count as unread and are skipped by future read updates.
- Deleting does not bump conversation ordering or change the original message creation time.
- Reusing the original send payload/client message ID returns `CONFLICT`; it cannot recreate the deleted message.
- A recipient reconnecting later sees the placeholder through REST history, even if they missed the socket event.

Deletion cannot retract content already delivered to a client. An in-flight older send acknowledgement or `message:new` event can also arrive after a deletion notification because database work and socket delivery are asynchronous. Clients must give a known deletion priority: once a message ID is deleted, do not restore its text from a late older event, acknowledgement, or cached history response. Refresh history after reconnects; live delivery remains best effort.

## Where the code lives

| File / function                                  | Responsibility                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dto/delete-message.dto.ts` / `DeleteMessageDto` | Validates the message UUID.                                                                                                                                                          |
| `chat.gateway.ts` / `deleteMessage()`            | Applies the event quota, authenticates, validates, calls the service, notifies both participants, and acknowledges.                                                                  |
| `chat.service.ts` / `deleteMessage()`            | Delegates to the repository.                                                                                                                                                         |
| `chat.repository.ts` / `deleteMessage()`         | Finds the conversation, locks it, checks membership/ownership, and clears text while preserving the first deletion time. Returns internal routing/change information to the gateway. |
| `chat.repository.ts` / `saveMessage()`           | Rejects retries of deleted messages.                                                                                                                                                 |
| `chat.repository.ts` / `toResponses()`           | Excludes deleted messages from unread counts while keeping placeholders in latest-message previews.                                                                                  |
| `chat.repository.ts` / `markMessagesRead()`      | Skips deleted messages.                                                                                                                                                              |
| `entities/message.entity.ts`                     | Adds nullable content and a normal nullable deletion column; not a TypeORM hidden-row soft-delete column.                                                                            |
| `dto/message-response.dto.ts`                    | Documents nullable content and `deletedAt` for REST and shared message shapes.                                                                                                       |
| `interface/chat-event.interface.ts`              | Adds `MessageDeleted` and the outgoing event type.                                                                                                                                   |
| `database/data-source.ts`                        | Registers the new migration.                                                                                                                                                         |

Functions include source comments. The [study guide](CHAT_STUDY_GUIDE.md) explains how the module layers fit together.

## Verification

```bash
npm test
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/chat/chat.postgres.spec.ts
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e
```

The focused deletion unit tests are in `src/chat/chat.message-deletion.spec.ts`. The existing `src/chat/chat.gateway.spec.ts` deletion in the working tree was left untouched.

Real PostgreSQL/Socket.IO tests cover sender-only permissions (including admins), both participants' tabs, outsiders, malformed input, repeated/concurrent deletes, first-timestamp preservation, removed text in history/previews, unread/read behavior, send retries, offline recovery, migration revert/reapply, rollback refusal after deletion, and database content constraints. The full AppModule acceptance test also sends and deletes a message through real sockets. Tests use disposable schemas and local connections; application records are not modified.
