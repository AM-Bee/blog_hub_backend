# Backend structure and coding conventions

BlogHub follows the company's feature-folder and repository conventions while keeping NestJS, TypeORM, ESM imports, UUIDs, and the existing API contract.

```text
src/
├── database/
│   └── database.module.ts
├── common/
│   ├── validation.utils.ts
│   └── taxonomy.utils.ts
├── auth/
│   ├── decorators/
│   ├── dto/
│   ├── entities/
│   ├── guards/
│   ├── interfaces/
│   ├── auth.config.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── auth.repository.ts
│   ├── auth.module.ts
│   └── password-reset-mail.service.ts
├── users/
│   ├── dto/
│   ├── entities/
│   ├── enums/
│   ├── interfaces/
│   ├── users.service.ts
│   ├── users.repository.ts
│   └── users.module.ts
├── categories/
├── tags/
├── blogs/
│   ├── dto/
│   ├── entities/
│   ├── enums/
│   ├── interfaces/
│   ├── blogs.controller.ts
│   ├── blogs.service.ts
│   ├── blogs.repository.ts
│   ├── blogs.module.ts
│   └── blog-image.store.ts
├── admin-users/
├── asset/images/
├── app.module.ts
├── main.ts
└── seed.ts
```

Categories, Tags, and Admin Users have the same controller/service/repository/module pattern, with DTOs and interfaces. TypeORM entities stay with the owning feature. Admin Users reuses the Users entity, so it has no separate entity. Users is an internal module: self-service HTTP routes remain in Auth; admin routes remain in Admin Users.

## Responsibilities

- **Controller:** routes, request parameters, validation pipes, guards, Swagger declarations, cookies, and upload interceptors.
- **Service:** a small explicit entry point for each feature operation, delegating to its repository. Auth also coordinates credential checks, token signing, reset email delivery, and session transactions.
- **Repository:** TypeORM queries and the existing feature operations, including their validation, ownership checks, response mapping, and atomic writes. Operations that must succeed or roll back together remain in the same transaction. AuthRepository provides session/token lookups and locked account queries to AuthService.
- **DTO:** runtime request validation and Swagger request/response documentation.
- **Interface:** TypeScript definitions for returned data and authenticated users. Response DTO classes implement these interfaces; repositories return interface types rather than importing Swagger response classes.
- **Entity:** TypeORM table mappings, indexes, and relationships. This is the TypeORM equivalent of the company's Drizzle `schema/` folder.
- **Enum:** shared values such as UserRole, UserStatus, and BlogStatus.
- **Module:** registers controllers, services, repositories, and entity dependencies.

This follows the company's thin-service convention. There are no generic base services or controllers. Keeping the feature operations explicit preserves BlogHub's different permissions, transactions, and response formats.

## Style

Use kebab-case filenames, PascalCase classes/interfaces/enums, camelCase properties and methods, and snake_case database columns. Use two-space indentation, single quotes, semicolons, trailing commas, and braces around conditional and loop bodies. Prettier applies the formatting.

Use constructor injection. Explicit `@Inject()` annotations remain where needed by the current ESM/test setup. Keep `.js` extensions on local imports for Node ESM. Use `import type` for interfaces and other types that do not exist at runtime.

Tests stay alongside the feature code. Existing tests construct the real service/repository pair or supply the native TypeORM repository as a mock.

## Database configuration

AppModule loads `.env` through the global ConfigModule. DatabaseModule configures TypeORM through ConfigService using DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, and DB_NAME. DB_PORT is converted to a number; if omitted, the API defaults to its previous port, 5433. Set DB_PORT explicitly so the API, seed scripts, and database tests use the same database port.

This refactor does not change table mappings or require a migration. Development schema synchronization remains enabled; introducing production migrations is a separate task.

## Verification

```bash
npm run build
npm run lint
npm test
BLOGHUB_RUN_DB_TESTS=1 npm test -- src/users/account.postgres.spec.ts src/admin-users/admin-users.postgres.spec.ts src/blogs/blogs.moderation.postgres.spec.ts
```

Database regression tests use unique temporary schemas and mocked email delivery. The unit/module suite also checks feature dependency injection and Swagger generation without a live database.
