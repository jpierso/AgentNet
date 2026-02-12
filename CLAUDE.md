# AgentNet — AI Agent Identity & Access Management

## Project Overview

Enterprise IAM platform for AI agents. Manages agent identities, scoped delegation, access controls, audit trails, and lifecycle — ensuring agents act on behalf of users with least privilege and full accountability.

## Implementation Status

| Phase | Name | Description |
|-------|------|-------------|
| 0 | Foundation | Agent identity schema, registry CRUD, JWT token issuance |
| 1 | Permission Boundaries | Scoped delegation, permission CRUD, scope validation |
| 2 | Audit & Observability | Structured audit events, trace correlation, HTTP audit hook |
| 3 | Policy Engine & Approvals | Rule-based policy evaluation, token exchange with approval gates |
| 4 | Consent & Attestation | User consent grants, attestation campaigns, access reviews, drift detection |
| 5 | Lifecycle Management | Token revocation, lifecycle event processing, agent suspension/reactivation, governance endpoints |

All phases complete. 267 tests passing, 46 endpoints across 16 route files.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict, ESM via NodeNext) |
| Runtime | Node.js 20+ |
| Framework | Fastify 5 |
| Database | PostgreSQL 15+ |
| ORM | Drizzle ORM |
| Validation | Zod v4 + fastify-type-provider-zod v6 |
| Auth/IdP | Okta (stubbed via `IIdentityProvider` + `StubIdentityProvider`) |
| Tokens | JWT (jsonwebtoken) with custom claims |
| Testing | Vitest |
| Package Manager | pnpm |

## Project Structure

```
src/
  index.ts                              # Entry point
  app.ts                                # Fastify app factory (buildApp)
  config/
    env.ts                              # Zod-validated env config
  db/
    schema.ts                           # Drizzle schema (11 tables)
    connection.ts                       # DB client + Drizzle instance
  plugins/
    db.plugin.ts                        # Fastify plugin — decorates app with db
    error-handler.plugin.ts             # Centralized error handler (AppError)
    trace-id.plugin.ts                  # Request trace ID generation
    audit-hook.plugin.ts                # HTTP-level audit capture
    permission-check.plugin.ts          # Permission validation helpers
  routes/
    health.route.ts                     # GET /health
    agents.route.ts                     # CRUD: POST/GET/PATCH/DELETE /agents
    token.route.ts                      # POST /agents/:agentId/token
    token-exchange.route.ts             # POST /agents/:agentId/token/exchange
    token-revocation.route.ts           # POST /tokens/revoke, /tokens/introspect
    permissions.route.ts                # CRUD /permissions + GET /agents/:agentId/permissions
    policies.route.ts                   # CRUD /policies + POST /policies/evaluate
    approvals.route.ts                  # GET/POST /approvals/:approvalId
    consents.route.ts                   # CRUD /consents
    access-reviews.route.ts             # GET /access-reviews/users/:userId
    attestation-campaigns.route.ts      # CRUD /attestation-campaigns + progress/cancel/process-expired
    attestation-items.route.ts          # GET/POST /attestation-items
    drift-detection.route.ts            # GET /drift-detection + /drift-detection/agents/:agentId
    agent-governance.route.ts           # GET /agents/:agentId/{consents,attestation-items,drift}
    audit.route.ts                      # GET /audit-events + /audit-events/trace/:traceId
    lifecycle-events.route.ts           # POST /lifecycle-events
  schemas/
    agent.schema.ts                     # Agent CRUD schemas
    token.schema.ts                     # Token issuance schemas
    token-exchange.schema.ts            # Token exchange (RFC 8693) schemas
    token-revocation.schema.ts          # Revoke + introspect schemas
    permission.schema.ts                # Permission boundary schemas
    policy.schema.ts                    # Policy rule + evaluation schemas
    approval.schema.ts                  # Approval review schemas
    consent.schema.ts                   # Consent grant schemas
    attestation.schema.ts               # Campaign + item schemas
    access-review.schema.ts             # Access review dashboard schemas
    drift-detection.schema.ts           # Drift detection schemas
    audit.schema.ts                     # Audit query/trace schemas
    lifecycle-event.schema.ts           # Lifecycle webhook schemas
  services/
    agent.service.ts                    # Agent CRUD + list
    permission.service.ts               # Permission CRUD + scope validation
    audit.service.ts                    # Audit recording + querying
    audit-events.ts                     # Audit action/resource constants
    audit-store.ts                      # IAuditStore interface
    pg-audit-store.ts                   # Postgres audit store implementation
    policy-engine.ts                    # IPolicyEngine interface
    pg-policy-engine.ts                 # Postgres policy engine implementation
    conditions-evaluator.ts             # Policy conditions evaluation
    approval.service.ts                 # Approval workflow
    consent.service.ts                  # Consent grant/revoke
    attestation.service.ts              # Campaign + item management
    access-review.service.ts            # Access review dashboard
    drift-detection.service.ts          # Permission drift detection
    revocation-set.ts                   # In-memory revocation tracking
    token-revocation.service.ts         # Token revocation (single + blanket)
    lifecycle.service.ts                # Lifecycle event processing
    identity-provider.ts               # IIdentityProvider interface
    stub-identity-provider.ts           # Stub: local JWT signing
  types/
    fastify.d.ts                        # Type augmentation (db, auditService, policyEngine, revocationSet)
tests/
  setup.ts                             # Vitest global setup
  helpers.ts                           # buildTestApp, cleanDatabase, createTestAgent, etc.
  *.test.ts                            # 20 test files
```

## Commands

```bash
docker compose up -d                # Start PostgreSQL (dev:5432 + test:5433)
pnpm dev                            # Run dev server with hot reload
pnpm build                          # Compile TypeScript to dist/
pnpm start                          # Run compiled server
pnpm db:generate                    # Generate Drizzle migration files
pnpm db:push                        # Push schema directly to DB
pnpm db:migrate                     # Run pending migrations
pnpm test                           # Run tests (requires test DB on :5433)
pnpm typecheck                      # Type check without emitting
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | JWT signing key (min 16 chars) |
| `WEBHOOK_SECRET` | Yes | — | Lifecycle webhook auth (min 16 chars) |
| `JWT_ISSUER` | No | `agentnet` | JWT issuer claim |
| `JWT_AUDIENCE` | No | `agentnet-api` | JWT audience claim |
| `JWT_TTL_MINUTES` | No | `15` | Default token TTL (1–60) |
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `NODE_ENV` | No | `development` | Environment mode |
| `LOG_LEVEL` | No | `info` | Pino log level |

## Conventions

- Use strict TypeScript (`strict: true`)
- Prefer Drizzle ORM for schema definitions and migrations
- All API routes use Fastify with Zod type provider for validation
- All database IDs are UUIDs
- Agent lifecycle states: `active`, `suspended`, `revoked`, `deprovisioned`
- Permission action tiers: `tier_0` (read-only), `tier_1` (low-risk write), `tier_2` (approval required), `tier_3` (blocked)
- Policy effects: `allow`, `deny`, `require_approval`
- JWT claims must include: `agent_id`, `owner_user_id`, `manager_user_id`
- Every agent must have a valid `owner_user_id` and `manager_user_id` at registration
- All state-changing operations produce audit events
- Follow OWASP guidelines — no secrets in code, parameterized queries, input validation

## Documentation

- [`docs/API.md`](docs/API.md) — Full API reference (46 endpoints)
- [`docs/DEVELOPER.md`](docs/DEVELOPER.md) — Developer guide, architecture, testing patterns
