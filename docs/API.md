# AgentNet API Reference

Base URL: `http://localhost:3000`

All request/response bodies are JSON. Paginated endpoints accept `limit` (1–100, default 20) and `offset` (default 0) query parameters and return `{ data, total, limit, offset }`.

---

## Health

### GET /health

Health check with database connectivity verification.

**Response 200:**

```json
{ "status": "ok", "timestamp": "2026-01-01T00:00:00.000Z", "service": "agentnet-registry" }
```

**Response 503:** Database connection failed.

---

## Agents

Source: `agents.route.ts`

### POST /agents

Create a new agent identity.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | Yes | Unique agent identifier (1–255 chars) |
| `ownerUserId` | UUID | Yes | Owner user ID (validated against IdP) |
| `managerUserId` | UUID | Yes | Manager user ID (validated against IdP) |
| `agentType` | string | Yes | Agent type (1–100 chars) |
| `modelVersion` | string | No | Model version (max 50 chars) |
| `purpose` | string | No | Agent purpose (max 500 chars) |
| `oktaClientId` | string | No | Okta client ID (max 255 chars) |

**Response 201:** Agent object.

**Errors:** `422` — invalid owner/manager user ID.

### GET /agents/:agentId

Get agent by agent ID.

**Params:** `agentId` (string)

**Response 200:** Agent object.

**Errors:** `404` — agent not found.

### PATCH /agents/:agentId

Update agent fields.

**Params:** `agentId` (string)

**Request Body:** (all optional)

| Field | Type | Description |
|-------|------|-------------|
| `managerUserId` | UUID | New manager |
| `agentType` | string | Agent type |
| `modelVersion` | string | Model version |
| `purpose` | string | Purpose |
| `lifecycleState` | enum | `active`, `suspended`, `revoked`, `deprovisioned` |
| `oktaClientId` | string | Okta client ID |

**Response 200:** Updated agent object.

### DELETE /agents/:agentId

Soft delete (sets lifecycle state to `revoked`).

**Params:** `agentId` (string)

**Response 200:** Revoked agent object.

### GET /agents

List agents with filters.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `ownerUserId` | UUID | Filter by owner |
| `managerUserId` | UUID | Filter by manager |
| `lifecycleState` | enum | Filter by state |
| `limit` | number | Page size (1–100, default 20) |
| `offset` | number | Offset (default 0) |

**Response 200:** `{ data: Agent[], total, limit, offset }`

### Agent Object

```json
{
  "id": "uuid",
  "agentId": "string",
  "ownerUserId": "uuid",
  "managerUserId": "uuid",
  "agentType": "string",
  "modelVersion": "string | null",
  "purpose": "string | null",
  "lifecycleState": "active | suspended | revoked | deprovisioned",
  "oktaClientId": "string | null",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

---

## Agent Tokens

Source: `token.route.ts`

### POST /agents/:agentId/token

Issue a short-lived JWT for an agent.

**Params:** `agentId` (string)

**Request Body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `ttlMinutes` | number | No | 15 | Token TTL in minutes (1–60) |

**Response 200:**

```json
{
  "accessToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "expiresAt": "ISO 8601"
}
```

**Errors:** `404` — agent not found.

---

## Token Exchange

Source: `token-exchange.route.ts`

### POST /agents/:agentId/token/exchange

Exchange a parent token for a downscoped token (RFC 8693). Validates scope against permission boundaries and policy rules. May require approval for tier 2 operations.

**Params:** `agentId` (string)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `grant_type` | string | Yes | Must be `urn:ietf:params:oauth:grant-type:token-exchange` |
| `subject_token` | string | Yes | Parent JWT to exchange |
| `subject_token_type` | string | Yes | Must be `urn:ietf:params:oauth:token-type:access_token` |
| `scope` | string[] | Yes | Requested scopes (e.g., `["documents:read"]`) |
| `ttlMinutes` | number | No | Token TTL (1–60, default 15) |
| `approvalId` | UUID | No | Approved request ID (if resuming after approval) |

**Response 200:** Downscoped token issued.

```json
{
  "accessToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "expiresAt": "ISO 8601",
  "scope": ["documents:read"],
  "tokenKind": "downscoped"
}
```

**Response 202:** Approval required (policy returned `require_approval`).

```json
{
  "approvalId": "uuid",
  "status": "pending_approval",
  "requiredApprovals": [{ "resource": "...", "action": "...", "reason": "..." }],
  "expiresAt": "ISO 8601"
}
```

**Errors:** `401` — parent token revoked. `403` — scope exceeds boundaries, policy denied, or agent not active.

---

## Token Operations

Source: `token-revocation.route.ts`

### POST /tokens/revoke

Revoke a specific token (by JTI) or all tokens for an agent (blanket revocation).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jti` | string | One of `jti`/`agentId` | Token JTI to revoke |
| `agentId` | string | One of `jti`/`agentId` | Agent ID for blanket revocation |
| `revokedBy` | string | Yes | User performing revocation |
| `reason` | string | Yes | Reason (1–500 chars) |

**Response 200:**

```json
{ "revoked": true, "jti": "...", "type": "single" }
```
or
```json
{ "revoked": true, "agentId": "...", "type": "blanket" }
```

### POST /tokens/introspect

Check if a token is active. Verifies JWT signature, expiry, revocation status, and agent lifecycle state.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | JWT to introspect |

**Response 200 (active):**

```json
{
  "active": true,
  "agentId": "string",
  "ownerUserId": "uuid",
  "managerUserId": "uuid",
  "agentType": "string",
  "scope": ["string"],
  "tokenType": "standard | downscoped",
  "issuedAt": "ISO 8601",
  "expiresAt": "ISO 8601"
}
```

**Response 200 (inactive):**

```json
{ "active": false, "agentId": "string", "revoked": true }
```

---

## Permissions

Source: `permissions.route.ts`

### POST /permissions

Create a permission boundary.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `resource` | string | Yes | Resource name (1–255 chars) |
| `allowedActions` | string[] | Yes | Allowed actions |
| `actionTier` | enum | Yes | `tier_0`, `tier_1`, `tier_2`, `tier_3` |
| `conditions` | object | No | Contextual conditions |
| `grantedBy` | UUID | Yes | User granting permission |
| `expiresAt` | datetime | No | Expiration time |

**Response 201:** Permission object.

### GET /permissions/:permissionId

Get permission by ID.

**Params:** `permissionId` (UUID)

**Response 200:** Permission object.

### GET /permissions

List permissions with filters.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `agentId` | string | Filter by agent |
| `resource` | string | Filter by resource |
| `actionTier` | enum | Filter by tier |
| `limit` | number | Page size |
| `offset` | number | Offset |

**Response 200:** `{ data: Permission[], total, limit, offset }`

### PATCH /permissions/:permissionId

Update a permission boundary.

**Params:** `permissionId` (UUID)

**Request Body:** (all optional)

| Field | Type | Description |
|-------|------|-------------|
| `allowedActions` | string[] | New allowed actions |
| `actionTier` | enum | New tier |
| `conditions` | object/null | New conditions |
| `expiresAt` | datetime/null | New expiration |

**Response 200:** Updated permission object.

### DELETE /permissions/:permissionId

Delete a permission boundary.

**Params:** `permissionId` (UUID)

**Response 200:** Deleted permission object.

### GET /agents/:agentId/permissions

List all permissions for a specific agent.

**Params:** `agentId` (string)

**Response 200:** `{ data: Permission[], total, limit, offset }`

### Permission Object

```json
{
  "id": "uuid",
  "agentId": "string",
  "resource": "string",
  "allowedActions": ["string"],
  "actionTier": "tier_0 | tier_1 | tier_2 | tier_3",
  "conditions": "object | null",
  "grantedBy": "uuid",
  "expiresAt": "ISO 8601 | null",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

---

## Policies

Source: `policies.route.ts`

### POST /policies

Create a policy rule.

**Request Body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Unique policy name (1–255 chars) |
| `description` | string | No | — | Description (max 1000 chars) |
| `enabled` | boolean | No | `true` | Whether rule is active |
| `priority` | number | No | `0` | Higher = evaluated first (0–10000) |
| `resourcePattern` | string | Yes | — | Resource glob pattern |
| `actionPattern` | string | Yes | — | Action glob pattern |
| `agentTypePattern` | string | No | — | Agent type glob pattern |
| `tier` | enum | No | — | `tier_0`–`tier_3` |
| `conditions` | object | No | — | Time/IP conditions |
| `effect` | enum | Yes | — | `allow`, `deny`, `require_approval` |

**Response 201:** Policy object.

### GET /policies

List policy rules.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Filter by enabled status |
| `resourcePattern` | string | Filter by resource pattern |
| `limit` | number | Page size |
| `offset` | number | Offset |

**Response 200:** `{ data: Policy[], total, limit, offset }`

### GET /policies/:policyId

Get policy by ID.

**Params:** `policyId` (UUID)

**Response 200:** Policy object.

### PATCH /policies/:policyId

Update a policy rule.

**Params:** `policyId` (UUID)

**Request Body:** All fields from create, all optional.

**Response 200:** Updated policy object.

### DELETE /policies/:policyId

Delete a policy rule.

**Params:** `policyId` (UUID)

**Response 200:** Deleted policy object.

### POST /policies/evaluate

Dry-run policy evaluation against current rules.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `agentType` | string | Yes | Agent type |
| `resource` | string | Yes | Resource to access |
| `action` | string | Yes | Action to perform |
| `actionTier` | enum | Yes | `tier_0`–`tier_3` |
| `ipAddress` | string | No | Client IP |

**Response 200:**

```json
{
  "effect": "allow | deny | require_approval",
  "matchedRules": [{ "ruleId": "uuid", "name": "string", "effect": "string" }],
  "reasons": ["string"]
}
```

### Policy Object

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string | null",
  "enabled": true,
  "priority": 0,
  "resourcePattern": "string",
  "actionPattern": "string",
  "agentTypePattern": "string | null",
  "tier": "string | null",
  "conditions": "object | null",
  "effect": "allow | deny | require_approval",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

---

## Approvals

Source: `approvals.route.ts`

### GET /approvals/:approvalId

Get approval request status.

**Params:** `approvalId` (UUID)

**Response 200:** Approval object.

### POST /approvals/:approvalId/review

Approve or deny a pending approval request.

**Params:** `approvalId` (UUID)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `decision` | enum | Yes | `approved` or `denied` |
| `reviewedBy` | string | Yes | Reviewer user ID |
| `note` | string | No | Review note (max 1000 chars) |

**Response 200:** Updated approval object.

### Approval Object

```json
{
  "id": "uuid",
  "agentId": "string",
  "requestedBy": "string",
  "requestedScopes": ["string"],
  "grantedPermissions": [{ "resource": "string", "actions": ["string"], "tier": "string" }],
  "parentTokenJti": "string",
  "ttlMinutes": 15,
  "status": "pending | approved | denied | expired",
  "reviewedBy": "string | null",
  "reviewedAt": "ISO 8601 | null",
  "reviewNote": "string | null",
  "expiresAt": "ISO 8601",
  "createdAt": "ISO 8601"
}
```

---

## Consents

Source: `consents.route.ts`

### POST /consents

Grant user consent for an agent.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `userId` | UUID | Yes | Consenting user ID |
| `scopes` | string[] | Yes | Consented scopes |

**Response 201:** Consent object.

### GET /consents

List consents with filters.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `userId` | UUID | Filter by user |
| `agentId` | string | Filter by agent |
| `status` | enum | `active` or `revoked` |
| `limit` | number | Page size |
| `offset` | number | Offset |

**Response 200:** `{ data: Consent[], total, limit, offset }`

### GET /consents/:consentId

Get consent by ID.

**Params:** `consentId` (UUID)

**Response 200:** Consent object.

### DELETE /consents/:consentId

Revoke a consent grant.

**Params:** `consentId` (UUID)

**Query Parameters:** `userId` (string, optional — defaults to `system`)

**Response 200:** Revoked consent object.

### Consent Object

```json
{
  "id": "uuid",
  "agentId": "string",
  "userId": "uuid",
  "permissionSnapshot": [{}],
  "scopes": ["string"],
  "status": "active | revoked",
  "revokedAt": "ISO 8601 | null",
  "revokedBy": "string | null",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

---

## Attestation Campaigns

Source: `attestation-campaigns.route.ts`

### POST /attestation-campaigns

Create an attestation campaign. Automatically generates review items for matching agents/permissions.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Campaign name (1–255 chars) |
| `description` | string | No | Description (max 1000 chars) |
| `frequency` | enum | Yes | `quarterly`, `semi_annual`, `annual`, `ad_hoc` |
| `scope` | enum | Yes | `all_agents`, `sensitive_only`, `specific_agents` |
| `scopeFilter` | object | No | `{ agentIds?, ownerUserIds?, minTier? }` |
| `createdBy` | UUID | Yes | Creator user ID |
| `dueDate` | datetime | Yes | Campaign due date |

**Response 201:**

```json
{
  "campaign": { /* Campaign object */ },
  "itemsGenerated": 42
}
```

### GET /attestation-campaigns

List campaigns with filters.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `status` | enum | `active`, `completed`, `cancelled` |
| `limit` | number | Page size |
| `offset` | number | Offset |

**Response 200:** `{ data: Campaign[], total, limit, offset }`

### GET /attestation-campaigns/:campaignId

Get campaign by ID.

**Params:** `campaignId` (UUID)

**Response 200:** Campaign object.

### GET /attestation-campaigns/:campaignId/progress

Get campaign review progress.

**Params:** `campaignId` (UUID)

**Response 200:**

```json
{
  "campaignId": "uuid",
  "total": 100,
  "pending": 30,
  "attested": 60,
  "rejected": 5,
  "autoSuspended": 5
}
```

### POST /attestation-campaigns/:campaignId/cancel

Cancel an active campaign.

**Params:** `campaignId` (UUID)

**Response 200:** Updated campaign object (status: `cancelled`).

### POST /attestation-campaigns/:campaignId/process-expired

Process expired campaign: auto-suspends agents with unreviewed items.

**Params:** `campaignId` (UUID)

**Response 200:**

```json
{ "suspendedCount": 5 }
```

### Campaign Object

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string | null",
  "frequency": "quarterly | semi_annual | annual | ad_hoc",
  "scope": "all_agents | sensitive_only | specific_agents",
  "scopeFilter": "object | null",
  "status": "active | completed | cancelled",
  "createdBy": "uuid",
  "dueDate": "ISO 8601",
  "completedAt": "ISO 8601 | null",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

---

## Attestation Items

Source: `attestation-items.route.ts`

### GET /attestation-items

List attestation items with filters.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `campaignId` | UUID | Filter by campaign |
| `reviewerUserId` | UUID | Filter by reviewer |
| `agentId` | string | Filter by agent |
| `status` | enum | `pending`, `attested`, `rejected`, `auto_suspended` |
| `limit` | number | Page size |
| `offset` | number | Offset |

**Response 200:** `{ data: Item[], total, limit, offset }`

### GET /attestation-items/:itemId

Get attestation item by ID.

**Params:** `itemId` (UUID)

**Response 200:** Item object.

### POST /attestation-items/:itemId/review

Review an attestation item.

**Params:** `itemId` (UUID)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `decision` | enum | Yes | `confirm` or `revoke` |
| `decisionNote` | string | No | Review note (max 1000 chars) |
| `reviewerUserId` | UUID | Yes | Reviewer user ID |

**Response 200:** Updated item object.

### Attestation Item Object

```json
{
  "id": "uuid",
  "campaignId": "uuid",
  "agentId": "string",
  "permissionId": "uuid",
  "reviewerUserId": "uuid",
  "reviewerRole": "owner | manager | security_delegate",
  "permissionSnapshot": {},
  "status": "pending | attested | rejected | auto_suspended",
  "decision": "confirm | revoke | null",
  "decisionNote": "string | null",
  "decidedAt": "ISO 8601 | null",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

---

## Access Reviews

Source: `access-reviews.route.ts`

### GET /access-reviews/users/:userId

Get a comprehensive access review dashboard for a user, listing all their agents with permissions and consents.

**Params:** `userId` (UUID)

**Response 200:**

```json
{
  "userId": "uuid",
  "agents": [
    {
      "agentId": "string",
      "agentType": "string",
      "lifecycleState": "string",
      "permissions": [
        {
          "id": "uuid",
          "resource": "string",
          "allowedActions": ["string"],
          "actionTier": "string",
          "expiresAt": "ISO 8601 | null",
          "lastUsed": "ISO 8601 | null"
        }
      ],
      "consents": [
        {
          "id": "uuid",
          "status": "string",
          "scopes": ["string"],
          "createdAt": "ISO 8601"
        }
      ]
    }
  ],
  "reviewedAt": "ISO 8601"
}
```

---

## Drift Detection

Source: `drift-detection.route.ts`

### GET /drift-detection/agents/:agentId

Detect permission drift for a specific agent by comparing current permissions against the last attested baseline.

**Params:** `agentId` (string)

**Response 200:**

```json
{
  "agentId": "string",
  "hasDrift": true,
  "drifts": [
    {
      "permissionId": "uuid | null",
      "resource": "string",
      "driftType": "added | removed | modified",
      "baseline": "object | null",
      "current": "object | null"
    }
  ],
  "baselineCampaignId": "uuid | null",
  "detectedAt": "ISO 8601"
}
```

### GET /drift-detection

Batch drift detection across all agents (optionally filtered by owner).

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `ownerUserId` | UUID | Filter by owner user |

**Response 200:**

```json
{
  "agents": [ /* array of agent drift responses */ ],
  "detectedAt": "ISO 8601"
}
```

---

## Agent Governance

Source: `agent-governance.route.ts`

Agent-scoped convenience endpoints for governance data.

### GET /agents/:agentId/consents

List all consent grants for an agent.

**Params:** `agentId` (string)

**Response 200:** `{ data: Consent[], total, limit, offset }`

### GET /agents/:agentId/attestation-items

List all attestation items for an agent.

**Params:** `agentId` (string)

**Response 200:** `{ data: AttestationItem[], total, limit, offset }`

### GET /agents/:agentId/drift

Detect permission drift for an agent (alias of `GET /drift-detection/agents/:agentId`).

**Params:** `agentId` (string)

**Response 200:** Agent drift response (see Drift Detection section).

---

## Audit Events

Source: `audit.route.ts`

### GET /audit-events

Query audit events with filters.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `agentId` | string | Filter by agent |
| `actorId` | string | Filter by actor |
| `actorType` | enum | `agent`, `user`, `system` |
| `action` | string | Filter by action name |
| `resourceType` | enum | `agent`, `permission`, `token`, `http` |
| `outcome` | enum | `success`, `failure`, `denied` |
| `from` | datetime | Start of time range |
| `to` | datetime | End of time range |
| `limit` | number | Page size |
| `offset` | number | Offset |

**Response 200:** `{ data: AuditEvent[], total, limit, offset }`

### GET /audit-events/trace/:traceId

Get all audit events for a trace (session replay).

**Params:** `traceId` (string)

**Response 200:**

```json
{
  "traceId": "string",
  "events": [ /* AuditEvent[] */ ]
}
```

### Audit Event Object

```json
{
  "id": "uuid",
  "traceId": "string",
  "spanId": "string | null",
  "parentSpanId": "string | null",
  "timestamp": "ISO 8601",
  "agentId": "string | null",
  "actorType": "agent | user | system",
  "actorId": "string",
  "action": "string",
  "resource": "string",
  "resourceType": "string",
  "outcome": "success | failure | denied",
  "outcomeReason": "string | null",
  "metadata": "object | null",
  "requestMethod": "string | null",
  "requestPath": "string | null",
  "requestId": "string | null",
  "statusCode": "number | null",
  "durationMs": "number | null",
  "ipAddress": "string | null",
  "userAgent": "string | null"
}
```

---

## Lifecycle Events

Source: `lifecycle-events.route.ts`

### POST /lifecycle-events

Process a user lifecycle webhook event. Cascades to all agents owned/managed by the affected user.

**Auth:** Requires `X-Webhook-Secret` header matching `WEBHOOK_SECRET` env var.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventType` | enum | Yes | `user.suspended`, `user.reactivated`, `user.departed`, `user.role_changed` |
| `userId` | string | Yes | Affected user ID |
| `payload` | object | No | Additional event data |

**Response 200:**

```json
{
  "eventId": "uuid",
  "eventType": "user.suspended",
  "userId": "string",
  "status": "processed | failed",
  "agentsAffected": 3,
  "processedAt": "ISO 8601"
}
```

**Errors:** `401` — invalid or missing webhook secret.

---

## Endpoint Summary

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/health` | Health check |
| 2 | POST | `/agents` | Create agent |
| 3 | GET | `/agents/:agentId` | Get agent |
| 4 | PATCH | `/agents/:agentId` | Update agent |
| 5 | DELETE | `/agents/:agentId` | Revoke agent |
| 6 | GET | `/agents` | List agents |
| 7 | POST | `/agents/:agentId/token` | Issue agent token |
| 8 | POST | `/agents/:agentId/token/exchange` | Token exchange (RFC 8693) |
| 9 | POST | `/tokens/revoke` | Revoke token(s) |
| 10 | POST | `/tokens/introspect` | Introspect token |
| 11 | POST | `/permissions` | Create permission |
| 12 | GET | `/permissions/:permissionId` | Get permission |
| 13 | GET | `/permissions` | List permissions |
| 14 | PATCH | `/permissions/:permissionId` | Update permission |
| 15 | DELETE | `/permissions/:permissionId` | Delete permission |
| 16 | GET | `/agents/:agentId/permissions` | Agent permissions |
| 17 | POST | `/policies` | Create policy |
| 18 | GET | `/policies` | List policies |
| 19 | GET | `/policies/:policyId` | Get policy |
| 20 | PATCH | `/policies/:policyId` | Update policy |
| 21 | DELETE | `/policies/:policyId` | Delete policy |
| 22 | POST | `/policies/evaluate` | Evaluate policy |
| 23 | GET | `/approvals/:approvalId` | Get approval |
| 24 | POST | `/approvals/:approvalId/review` | Review approval |
| 25 | POST | `/consents` | Grant consent |
| 26 | GET | `/consents` | List consents |
| 27 | GET | `/consents/:consentId` | Get consent |
| 28 | DELETE | `/consents/:consentId` | Revoke consent |
| 29 | POST | `/attestation-campaigns` | Create campaign |
| 30 | GET | `/attestation-campaigns` | List campaigns |
| 31 | GET | `/attestation-campaigns/:campaignId` | Get campaign |
| 32 | GET | `/attestation-campaigns/:campaignId/progress` | Campaign progress |
| 33 | POST | `/attestation-campaigns/:campaignId/cancel` | Cancel campaign |
| 34 | POST | `/attestation-campaigns/:campaignId/process-expired` | Process expired |
| 35 | GET | `/attestation-items` | List items |
| 36 | GET | `/attestation-items/:itemId` | Get item |
| 37 | POST | `/attestation-items/:itemId/review` | Review item |
| 38 | GET | `/access-reviews/users/:userId` | Access review |
| 39 | GET | `/drift-detection/agents/:agentId` | Agent drift |
| 40 | GET | `/drift-detection` | Batch drift |
| 41 | GET | `/agents/:agentId/consents` | Agent consents |
| 42 | GET | `/agents/:agentId/attestation-items` | Agent attestation items |
| 43 | GET | `/agents/:agentId/drift` | Agent drift (alias) |
| 44 | GET | `/audit-events` | Query audit events |
| 45 | GET | `/audit-events/trace/:traceId` | Trace replay |
| 46 | POST | `/lifecycle-events` | Lifecycle webhook |
