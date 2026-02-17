# Agent Registration API Test UI

## Summary

A static HTML page served at `/` (or `/ui`) with a dropdown to select agent-related APIs, dynamic input fields based on the selected endpoint, a submit button, and a response display area. Uses vanilla HTML/CSS/JS—no build step.

---

## Scope: Agent Registration APIs

Based on [API.md](API.md) and [DEVELOPER.md](DEVELOPER.md), the UI supports these 6 endpoints:

| API | Method | Path | Key Inputs |
|-----|--------|------|-------------|
| Create Agent | POST | `/agents` | agentId, ownerUserId, managerUserId, agentType, modelVersion?, purpose?, oktaClientId? |
| Get Agent | GET | `/agents/:agentId` | agentId (path) |
| Update Agent | PATCH | `/agents/:agentId` | agentId (path), managerUserId?, agentType?, lifecycleState?, etc. |
| Revoke Agent | DELETE | `/agents/:agentId` | agentId (path) |
| List Agents | GET | `/agents` | ownerUserId?, managerUserId?, lifecycleState?, limit?, offset? (query) |
| Issue Token | POST | `/agents/:agentId/token` | agentId (path), ttlMinutes? (body) |

Validation rules from `src/schemas/agent.schema.ts`: `ownerUserId`/`managerUserId` must be valid UUIDs; stub IdP accepts any UUID format per `src/services/stub-identity-provider.ts`.

---

## Architecture

```
Browser                    Fastify
┌─────────────────┐       ┌──────────────────────┐
│ API Dropdown    │       │ @fastify/static      │
│ Dynamic Form    │──────▶│ Serves public/       │
│ Submit Button   │ fetch │ API Routes          │
│ Response Area   │◀──────│ /agents, /health...  │
└─────────────────┘       └──────────────────────┘
```

---

## Implementation

- **Dependency**: `@fastify/static`
- **Plugin**: Registered in `src/app.ts` with `root: public/`, `prefix: '/'`
- **Route order**: Static plugin registered after API routes so `/agents`, `/health` take precedence
- **File**: `public/index.html` — full UI (HTML + inline CSS + inline JS)

---

## CORS

Not required: UI and API share the same origin (e.g. `http://localhost:3000`).

---

## Testing

1. Run `pnpm dev`, open `http://localhost:3000` in a browser
2. Create an agent (POST /agents) with valid UUIDs
3. Get agent (GET /agents/:agentId)
4. Issue token (POST /agents/:agentId/token)
5. List agents (GET /agents) with optional filters
