# AgentNet Developer Guide

## Prerequisites

- **Node.js** 20+
- **pnpm** (`npm install -g pnpm`)
- **Docker** — PostgreSQL runs via Docker Compose (dev on port 5432, test on port 5433)

## Quick Start

```bash
git clone <repo-url> && cd AgentNet
pnpm install
docker compose up -d            # Start PostgreSQL (dev + test)
cp .env.example .env            # Configure DATABASE_URL, JWT_SECRET, WEBHOOK_SECRET
pnpm db:push                    # Push schema to dev DB
pnpm dev                        # Start dev server (http://localhost:3000)
pnpm test                       # Run test suite
```

## Architecture

### App Factory Pattern

The application is built via `buildApp()` in `src/app.ts`. This factory returns a configured Fastify instance and accepts an optional `database_url` override (used by tests to target the test database).

```
buildApp({ database_url?: string }) → FastifyInstance
```

### Plugin Registration Order

Plugins are registered in a specific order because later plugins depend on earlier ones:

1. **trace-id** — generates `request.traceId` for every request
2. **error-handler** — centralized `AppError` → JSON error responses
3. **db** — connects to PostgreSQL, decorates `app.db` (Drizzle instance)
4. *(service initialization)* — `AuditService`, `PgPolicyEngine`, `RevocationSet`
5. **audit-hook** — captures HTTP-level audit events on every response

### Route Registration

Each route file exports an async function registered with a URL prefix:

```typescript
await app.register(agentsRoute, { prefix: '/agents' });
```

Routes use `app.withTypeProvider<ZodTypeProvider>()` for request/response validation via Zod schemas.

### Service Layer

Business logic lives in `src/services/`. Route handlers instantiate services with `app.db` and delegate to them. Services accept Drizzle instances directly (no global singletons), making them testable.

### Drizzle ORM (Schema-First)

All tables are defined in `src/db/schema.ts` using Drizzle's `pgTable()`. Schema changes flow:

1. Edit `src/db/schema.ts`
2. `pnpm db:generate` — generates SQL migration files
3. `pnpm db:push` — pushes schema directly (dev) or `pnpm db:migrate` (production)

## Project Structure

```
src/
  index.ts                              # Entry point — calls buildApp() + listen()
  app.ts                                # App factory — plugin + route registration
  config/
    env.ts                              # Zod-validated environment variables
  db/
    schema.ts                           # All 11 Drizzle table definitions
    connection.ts                       # postgres + drizzle client creation
  plugins/
    db.plugin.ts                        # Decorates app.db
    error-handler.plugin.ts             # AppError class + error serialization
    trace-id.plugin.ts                  # X-Trace-Id header + request.traceId
    audit-hook.plugin.ts                # onResponse hook for HTTP audit events
    permission-check.plugin.ts          # Permission validation utilities
  routes/                               # 16 route files (48 endpoints)
  schemas/                              # 13 Zod schema files (request + response)
  services/                             # 19 service files (business logic)
  types/
    fastify.d.ts                        # Augments FastifyInstance with db, auditService, etc.
tests/
  setup.ts                             # Vitest globalSetup (DB connection check)
  helpers.ts                           # Test utilities
  *.test.ts                            # 20 integration test files
```

## Database

### Tables

| Table | Phase | Description |
|-------|-------|-------------|
| `agent_identities` | 0 | Core agent registry (agentId, owner, manager, lifecycle state) |
| `permission_boundaries` | 1 | Resource/action permissions per agent, with tiers and conditions |
| `audit_events` | 2 | Immutable audit log with trace correlation |
| `policy_rules` | 3 | Pattern-matched rules (allow/deny/require_approval) |
| `approval_requests` | 3 | Human-in-the-loop approval workflow for tier 2 operations |
| `consent_grants` | 4 | Explicit user consent for agent permissions |
| `attestation_campaigns` | 4 | Periodic recertification campaigns |
| `attestation_items` | 4 | Per-permission review items within campaigns |
| `token_revocations` | 5 | Revoked token JTIs (single) + blanket agent revocations |
| `lifecycle_events` | 5 | User lifecycle webhook events (suspended, departed, etc.) |
| `agent_suspension_records` | 5 | Tracks which lifecycle event suspended an agent |

### Drizzle Patterns

- `text()` columns infer as `string` — cast explicitly when Zod response schemas use literal unions (e.g., `lifecycleState as AgentResponse['lifecycleState']`)
- `jsonb()` with `.$type<T>()` for typed JSON columns
- `check()` constraints for enum-like text columns
- `index()` and `uniqueIndex()` for query performance

## Adding a New Endpoint

1. **Zod schema** — Create request/response schemas in `src/schemas/<domain>.schema.ts`
2. **Service method** — Add business logic in `src/services/<domain>.service.ts`
3. **Route handler** — Create `src/routes/<domain>.route.ts`:
   ```typescript
   import type { FastifyInstance } from 'fastify';
   import { ZodTypeProvider } from 'fastify-type-provider-zod';

   export async function myRoute(app: FastifyInstance) {
     const typedApp = app.withTypeProvider<ZodTypeProvider>();

     typedApp.route({
       method: 'POST',
       url: '/',
       schema: {
         body: myRequestSchema,
         response: { 201: myResponseSchema },
       },
       handler: async (request, reply) => {
         // ... service call + audit ...
         return reply.status(201).send(result);
       },
     });
   }
   ```
4. **Register** — Add import + `app.register(myRoute, { prefix: '/my-route' })` in `src/app.ts`
5. **Tests** — Write integration tests using `buildTestApp()` + `app.inject()`

## Testing

### Setup

Tests run against a separate PostgreSQL instance on port 5433 (configured in `docker-compose.yml`). The test database URL is hardcoded in `tests/helpers.ts`:

```
postgresql://agentnet_test:agentnet_test@localhost:5433/agentnet_test
```

### Utilities (`tests/helpers.ts`)

| Function | Description |
|----------|-------------|
| `buildTestApp()` | Creates a Fastify instance pointed at the test DB |
| `cleanDatabase(app)` | Truncates all tables in dependency order |
| `createTestAgent(overrides?)` | Returns a valid agent creation payload |
| `createTestPermission(agentId, overrides?)` | Returns a valid permission payload |
| `createTestConsent(agentId, overrides?)` | Returns a valid consent payload |
| `createTestCampaign(overrides?)` | Returns a valid attestation campaign payload |

### Pattern

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('My Feature', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app); });

  it('should do something', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/my-route',
      payload: { /* ... */ },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ /* ... */ });
  });
});
```

### Running Tests

```bash
docker compose up -d        # Ensure test DB is running
pnpm test                   # Run all tests
pnpm test -- --reporter=verbose  # Verbose output
```

## Key Patterns

### Error Handling

Use `AppError` from `src/plugins/error-handler.plugin.ts` for structured errors:

```typescript
throw new AppError(404, 'Not Found', 'Agent not found');
throw new AppError(422, 'Validation Error', 'Invalid input', { field: 'agentId' });
```

This produces JSON responses:

```json
{ "error": "Not Found", "message": "Agent not found", "statusCode": 404 }
```

### Audit Trail

All state-changing operations record audit events via `app.auditService.record()`:

```typescript
await app.auditService.record({
  traceId: request.traceId,
  actorType: ActorTypes.USER,
  actorId: userId,
  action: AuditActions.AGENT_CREATED,
  resource: `agent:${agentId}`,
  resourceType: ResourceTypes.AGENT,
  outcome: Outcomes.SUCCESS,
  metadata: { /* ... */ },
});
```

HTTP-level audit events are automatically captured by the `audit-hook` plugin.

### Token Revocation

The `RevocationSet` maintains an in-memory set of revoked token JTIs, loaded from the database at startup. It supports:

- **Single revocation** — revoke a specific JTI
- **Blanket revocation** — revoke all tokens for an agent (by `iat` timestamp)
- **Introspection** — check if a token is active (verifies JWT + revocation + agent state)

### Lifecycle Event Processing

The lifecycle endpoint accepts webhook events (`user.suspended`, `user.departed`, etc.) authenticated via `X-Webhook-Secret` header. Events cascade to all agents owned/managed by the affected user — suspending agents, revoking tokens, and creating suspension records.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | JWT signing key (min 16 chars) |
| `WEBHOOK_SECRET` | Yes | — | Lifecycle webhook authentication (min 16 chars) |
| `JWT_ISSUER` | No | `agentnet` | JWT `iss` claim |
| `JWT_AUDIENCE` | No | `agentnet-api` | JWT `aud` claim |
| `JWT_TTL_MINUTES` | No | `15` | Default token TTL in minutes (1–60) |
| `PORT` | No | `3000` | HTTP server port |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `LOG_LEVEL` | No | `info` | Pino log level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`) |
