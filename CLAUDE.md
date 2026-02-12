# AgentNet — AI Agent Identity & Access Management

## Project Overview

Enterprise IAM platform for AI agents. Manages agent identities, scoped delegation, access controls, audit trails, and lifecycle — ensuring agents act on behalf of users with least privilege and full accountability.

## Current Phase

**Phase 0: Foundation — Agent Identity & Registry** (Weeks 1–4)

Build order:
1. Agent Identity Schema & Database (PostgreSQL 15+)
2. Agent Registry Service — Core CRUD (TypeScript + Fastify)
3. User-Agent Binding Enforcement (validate owner/manager via Okta)
4. Okta Credential Issuance (short-lived JWT, 15–60 min TTL)

Exit criteria: create agent identity, issue short-lived token, look up agent in registry, see who owns/manages.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Runtime | Node.js |
| Framework | Fastify |
| Database | PostgreSQL 15+ |
| Migrations | Drizzle ORM |
| Auth/IdP | Okta (OAuth2 client credentials / token exchange) |
| Tokens | JWT with custom claims (agent_id, owner_user_id, manager_user_id) |
| Deployment | Docker + Kubernetes |

## Project Structure

```
src/
  index.ts                          # Entry point
  app.ts                            # Fastify app factory (buildApp)
  config/env.ts                     # Zod-validated env config
  db/schema.ts                      # Drizzle schema (agent_identities)
  db/connection.ts                  # DB client + Drizzle instance
  plugins/db.plugin.ts              # Fastify plugin — decorates app with db
  plugins/error-handler.plugin.ts   # Centralized error handler (AppError)
  routes/health.route.ts            # GET /health
  routes/agents.route.ts            # CRUD: POST/GET/PATCH/DELETE /agents
  routes/token.route.ts             # POST /agents/:agentId/token
  schemas/agent.schema.ts           # Zod schemas for agent CRUD
  schemas/token.schema.ts           # Zod schemas for token issuance
  services/agent.service.ts         # Business logic (CRUD + list)
  services/identity-provider.ts     # IIdentityProvider interface
  services/stub-identity-provider.ts # Stub: local JWT signing
  types/fastify.d.ts                # Type augmentation (db decorator)
tests/
  setup.ts, helpers.ts              # Test setup and utilities
  agents.test.ts                    # CRUD integration tests
  token.test.ts                     # Token issuance tests
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

## Conventions

- Use strict TypeScript (`strict: true`)
- Prefer Drizzle ORM for schema definitions and migrations
- All API routes go through Fastify with JSON Schema validation
- All database IDs are UUIDs
- Agent lifecycle states: `active`, `suspended`, `revoked`
- JWT claims must include: `agent_id`, `owner_user_id`, `manager_user_id`
- Every agent must have a valid `owner_user_id` and `manager_user_id` at registration
- Follow OWASP guidelines — no secrets in code, parameterized queries, input validation

## Planning Documents

Detailed plans are in the `.docx` files and `CONVERSATION_HISTORY.md`. Key references:
- **Phased roadmap:** 7 phases over 22 weeks (Phase 0–6)
- **Risk matrix:** 10 risks of inaction ranked by severity
- **Schema reference:** See CONVERSATION_HISTORY.md line 111–125
