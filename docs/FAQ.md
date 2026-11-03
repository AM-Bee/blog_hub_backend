# Database-driven FAQ support chatbot

This feature selects predefined answers from Supabase PostgreSQL. It makes no AI
requests and adds no packages, embeddings, vector search, chat history, or frontend
code. Existing JWT/session validation, roles, CORS, and security middleware remain
in place. FAQ categories are separate from blog categories.

## Deploy safely to Supabase

The current backend uses TypeORM with `DB_HOST`, `DB_PORT`, `DB_USERNAME`,
`DB_PASSWORD`, `DB_NAME`, `DB_SSL=true`, and the configured CA certificate. Keep
these credentials private. No new environment variables or Supabase keys are needed.
The migration runner and application both have `synchronize: false`.

From the backend folder:

```bash
npm run migration:run
npm run seed:faq
npm run start:dev
```

The migration command compiles the backend and applies pending migrations. The new
`AddFaqs1793664000000` creates only `faq_categories` and `faqs`; it does not modify
other application tables. Older pending migrations also run if they have not been
recorded yet. Running the command again skips recorded migrations.

In **Supabase → Table Editor**, refresh and verify both new tables. Do not create
them manually. Keep the backend-only Data API configuration described in
[SUPABASE.md](SUPABASE.md); the frontend calls NestJS rather than the database.

The FAQ seed uses the same database settings and a transaction. It inserts five
categories and 14 verified support FAQs. It uses stable IDs and skips existing
records, preserving answers, renamed questions/categories, matching settings,
ordering, and activation changes. It can reuse an existing seed category by name
or slug. Rerunning the seed can restore deleted seed FAQs; deactivate them to keep
them hidden across seed reruns. This seed does not create users or known demo
credentials. It does not require the general `npm run seed` command.

After migrating and seeding, commit/push the backend changes and wait for Render's
deployment to become **Live**. If Auto-Deploy is disabled, use **Manual Deploy →
Deploy latest commit**. Startup alone does not run migrations or seeds. Run these
commands locally against Supabase before deployment; Render will use the same
hosted tables if its database settings point to that project.

Neither migration nor seed is automatically applied to your live application
schema during development or tests. The migration's `down` drops only the two FAQ
tables and their data; normal `migration:run` never runs `down`.

## Tables

`faq_categories`:

| Column       | Purpose                                               |
| ------------ | ----------------------------------------------------- |
| `id`         | Generated UUID primary key                            |
| `name`       | Unique category name, up to 100 characters            |
| `slug`       | Unique lowercase URL-style slug, up to 150 characters |
| `created_at` | Timestamp with timezone                               |

`faqs`:

| Column                     | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `id`                       | Generated UUID primary key              |
| `category_id`              | Required foreign key to a FAQ category  |
| `question`                 | Main question, up to 500 characters     |
| `answer`                   | Predefined plain-text answer            |
| `alternative_questions`    | PostgreSQL text array, default empty    |
| `keywords`                 | PostgreSQL text array, default empty    |
| `is_active`                | Defaults to true                        |
| `display_order`            | Defaults to 0; lower numbers come first |
| `created_at`, `updated_at` | Timestamps with timezone                |

An index covers category, activation, ordering, and ID. Foreign keys prevent
missing categories. Deleting a nonempty FAQ category returns 409, including when
all its FAQs are inactive. Move or delete those FAQs first. Existing blog category
and tag deletion rules are unaffected.

Names and slugs have database uniqueness constraints. Names are case-sensitive;
slugs must be lowercase letters/digits separated by single hyphens. Questions may
overlap, but conflicting exact/alternative matches produce clarification
suggestions instead of an arbitrary answer.

## Public API

All paths below have prefix `/api/v1`. No login is required.

| Method | Path               | Behavior                                                   |
| ------ | ------------------ | ---------------------------------------------------------- |
| POST   | `/faq/ask`         | Find a clear active FAQ answer; HTTP 200 even for fallback |
| GET    | `/faq/suggestions` | Ordered active question suggestions                        |
| GET    | `/faq/categories`  | Categories containing at least one active FAQ              |
| GET    | `/faq/:id`         | One active FAQ by UUID; otherwise 404                      |

Ask body:

```json
{ "question": "How do I create a blog post?" }
```

Matched response:

```json
{
  "found": true,
  "answer": "The predefined answer stored by an admin.",
  "matchedQuestion": "How do I create a blog post?",
  "category": "Blog Management",
  "suggestions": []
}
```

Fallback response:

```json
{
  "found": false,
  "answer": "I couldn't find a clear answer to that question. Please try a more specific question or choose one of these FAQs.",
  "matchedQuestion": null,
  "category": null,
  "suggestions": [
    {
      "id": "a-faq-uuid",
      "question": "How do I log in?",
      "category": "Account"
    }
  ]
}
```

Suggestions use related active questions where possible, otherwise the first
three active FAQs in configured order. An empty active catalog returns an empty
suggestions array and `found: false`. Clicking a suggestion can fetch `/faq/:id`
to read the exact answer directly.

`GET /faq/suggestions` accepts optional `categoryId` (UUID) and `limit` (default 5,
maximum 10). It returns an array of `{ id, question, category }`. Unknown/empty
category filters return an empty array.

`GET /faq/:id` returns `{ id, question, answer, category }`. Public responses do not
include internal keywords, alternatives, inactive answers, credentials, or user
data. All answers are plain text; the frontend must render text safely rather
than inserting it as HTML.

## Admin API

Use the existing `Authorization: Bearer <accessToken>` header from an admin login.
The JWT guard checks the current account/session; RolesGuard requires `admin`.
Authors receive 403 and anonymous requests receive 401.

| Method | Path                        | Behavior                                   |
| ------ | --------------------------- | ------------------------------------------ |
| POST   | `/admin/faqs`               | Create; HTTP 201                           |
| GET    | `/admin/faqs`               | Paginated list including inactive FAQs     |
| GET    | `/admin/faqs/:id`           | Read full FAQ settings                     |
| PATCH  | `/admin/faqs/:id`           | Edit supplied fields only                  |
| DELETE | `/admin/faqs/:id`           | Permanent deletion; HTTP 204, no JSON body |
| POST   | `/admin/faq-categories`     | Create a separate FAQ category; HTTP 201   |
| GET    | `/admin/faq-categories`     | All FAQ categories, including empty ones   |
| PATCH  | `/admin/faq-categories/:id` | Change name and/or slug                    |
| DELETE | `/admin/faq-categories/:id` | Delete an empty category; HTTP 204         |

Create category:

```json
{ "name": "Account", "slug": "account" }
```

Create FAQ:

```json
{
  "categoryId": "replace-with-a-real-category-uuid",
  "question": "How do I log in?",
  "answer": "Use your registered email and password with POST /api/v1/auth/login.",
  "alternativeQuestions": ["How do I sign in?"],
  "keywords": ["login", "sign in"],
  "isActive": true,
  "displayOrder": 0
}
```

Only `categoryId`, `question`, and `answer` are required on create. Alternatives
and keywords default to `[]`; activation defaults to true; order defaults to 0.
PATCH accepts any subset without resetting omitted fields. Empty PATCH requests
and explicit nulls are rejected. Hide an answer without deleting it:

```json
{ "isActive": false }
```

Admin lists accept `page` (default 1), `limit` (default 10, maximum 50), optional
`categoryId` (UUID), and `isActive=true|false`. Response:
`{ items, page, limit, total, totalPages }`. Ordering is `displayOrder ASC, id ASC`.
Admin items include all editable fields, category name, ID, and timestamps.

Validation bounds question length to 1–500 characters, answer to 1–10000,
alternative questions to 20 entries of 1–500 characters, keywords to 20 entries
of 1–100 characters, and display order to integer 0–1000000. Text is trimmed.
Unknown fields and invalid UUIDs return 400. Missing FAQs/categories return 404;
category conflicts and invalid category references return 409 without SQL details.

## How matching works

1. Load **only active** FAQs and their categories from PostgreSQL.
2. Normalize Unicode, letter case, punctuation, and whitespace. Apply a small,
   explicit English synonym map: sign in/log in → login; sign up → register;
   post/article → blog; write → create; update → edit; remove → delete; and a few
   feature nouns/plurals.
3. Compare the normalized question against main questions and alternatives. One
   exact match wins. Multiple exact matches are ambiguous and do not answer.
4. Otherwise ignore common filler words for scoring. Text relevance weights query
   token coverage at 60% and candidate token coverage at 40%. It compares main and
   alternative questions and keeps the best text score.
5. Blend text relevance (80%) and matched keyword coverage (20%). Full keyword
   phrases or multiple matched keyword words can also provide a keyword-led
   score (80% keyword coverage, 20% text relevance). A phrase adds 0.05; scores
   are capped at 0.95. Whole-word boundaries prevent substring matches.
6. Require at least **0.72** for an approximate match. If a second candidate scores
   at least 0.60 and is within 0.12 of the best, return fallback suggestions.
   Exact-match ambiguity takes precedence over display ordering.
7. Tie-break suggestion order by display order and ID for deterministic results.

These scores are rules, not statistical confidence probabilities. The answer is
always copied from the matched database row, never generated or combined. No
user-provided text becomes SQL. No FAQ question history is persisted.

## Seed content and its evidence

`src/faq/seed-faqs.ts` contains 14 FAQs verified against:

- `src/auth/auth.controller.ts` / `auth.service.ts`: registration, email/password
  login, password change, and forgot/reset password. Reset email delivery depends
  on the existing server SMTP setup; the seed does not promise delivery.
- `src/blogs/blogs.controller.ts` / `blogs.repository.ts`: creation, editing,
  ownership/deletion, draft privacy, and admin publication blocking.
- `src/blogs/blog-image.store.ts`: JPEG/PNG/WebP, 5 MiB limit, multipart `image`,
  and Supabase Storage.
- Categories/Tags repositories: category/tag relationships and permissions.
- Blog list DTOs/repository: public search/filter/pagination.
- Comments repository: public reading, one reply level, editing and deletion rules.
- Reactions repository: like/dislike switching and removal.

The seed contains no unverified frontend button/screen instructions, company
contact email, or promise that optional Google/SMTP configuration is enabled.

## File guide

| File                                               | Responsibility                                            |
| -------------------------------------------------- | --------------------------------------------------------- |
| `src/faq/faq.module.ts`                            | Register entities, controllers, auth, and throttling      |
| `src/faq/entities/faq-category.entity.ts`          | FAQ category table mapping                                |
| `src/faq/entities/faq.entity.ts`                   | FAQ table, arrays, index, relationship                    |
| `src/faq/dto/faq-input.dto.ts`                     | Validated ask, admin writes, filters                      |
| `src/faq/dto/faq-response.dto.ts`                  | Swagger response schemas                                  |
| `src/faq/interfaces/faq.interface.ts`              | Response types                                            |
| `src/faq/faq.controller.ts`                        | Four public endpoints                                     |
| `src/faq/admin-faq.controller.ts`                  | Admin-only FAQ/category management                        |
| `src/faq/faq.service.ts`                           | Ask orchestration and operation entry points              |
| `src/faq/faq.repository.ts`                        | Active filtering, paging, CRUD, safe DB conflict handling |
| `src/faq/faq-matcher.ts`                           | Pure deterministic normalization/scoring                  |
| `src/faq/seed-faqs.ts`                             | Verified content and idempotent seed command              |
| `src/faq/faq.spec.ts`                              | Matching, ambiguity, and DTO tests                        |
| `src/database/migrations/1793664000000-AddFaqs.ts` | Only FAQ table creation                                   |
| `src/database/data-source.ts`                      | Register FAQ migration                                    |
| `src/app.module.ts`                                | Register FaqModule                                        |
| `package.json`                                     | Add `seed:faq` command                                    |
| `test/app.e2e-spec.ts`                             | Real HTTP/database FAQ checks in a disposable schema      |
| `src/database/migrations/initial-schema.spec.ts`   | Compare fresh migrated schema with all entities           |

README, STRUCTURE, and SUPABASE documentation also link or describe the feature.
Swagger is available at `/api/docs` (for example,
`http://localhost:5300/api/docs`). The new routes include request/response schemas
and examples.

## Test in Postman step by step

Set `baseUrl` to `http://localhost:5300/api/v1`, or the deployed backend URL plus
`/api/v1` after deployment.

1. Run migrations and `seed:faq` first.
2. GET `{{baseUrl}}/faq/categories`, No Auth. Save a category `id`.
3. GET `{{baseUrl}}/faq/suggestions?categoryId=<id>&limit=5`, No Auth.
4. POST `{{baseUrl}}/faq/ask`, raw JSON, `{"question":"How do I sign in?"}`.
   Expect 200, `found: true`, with the login answer.
5. Ask `{"question":"What is the weather tomorrow?"}`. Expect 200 with
   `found: false` and suggestions, not an invented answer.
6. Ask `{"question":"password"}`. Expect fallback because password reset and
   password change are different intents.
7. GET `{{baseUrl}}/faq/<suggestion-id>`. Expect its active answer.
8. Log in as an admin through the existing auth endpoint. Use its access token
   as Bearer auth for admin routes. Create a category with the example body above
   (choose a unique name/slug), then create a FAQ with its UUID.
9. GET `{{baseUrl}}/admin/faqs?categoryId=<uuid>&page=1&limit=10`.
10. PATCH `{{baseUrl}}/admin/faqs/<id>` with `{"isActive":false}`. Admin detail
    still works; public detail now returns 404 and ask/suggestions omit it.
11. Repeat a management request with an author token: expect 403. Remove the
    token: expect 401. Send invalid JSON fields: expect 400.
12. Try deleting its nonempty category: expect 409. Delete the FAQ (204), then
    delete the empty category (204). Use a temporary FAQ for this deletion test.
13. More than 20 asks from the same tracked IP within one minute returns 429.

## Verification and limits

```bash
npm test
npm run lint
npm run build
BLOGHUB_RUN_DB_TESTS=1 npm run test:e2e -- --testNamePattern 'FAQ'
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/database/migrations/initial-schema.spec.ts
```

Database tests use unique temporary schemas and clean them up; application tables
are not seeded, migrated, edited, or deleted by these tests. HTTP checks cover
admin guards, CRUD, activation filtering, category relationships, pagination,
PATCH preservation, idempotent seeding, and real 429 responses. The migration test
also verifies existing tables/entities are unchanged and migrations can rerun.

Public FAQ reads and admin requests use the existing Throttler implementation
with 60 requests per route/IP per minute; `/faq/ask` has 20 per minute. Storage is
in memory and per process, like the current auth limiter. Multiple replicas need
a shared rate-limit store. Tracker/proxy behavior follows the existing backend;
request headers do not grant FAQ permissions.

Matching reads the active catalog on each ask. This keeps admin edits immediately
visible without cache invalidation. For a large catalog, add bounded database
candidate retrieval before scoring. English synonym rules do not understand
arbitrary paraphrases, typos, negation, or other languages semantically. Admins
should add precise alternatives/keywords and test overlapping intents. FAQ
answers must remain current when the underlying backend behavior changes.
