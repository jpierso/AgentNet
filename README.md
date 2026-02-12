![Project Logo](images/AgentNet.png)

## Executive Summary

AI agents acting on behalf of users fundamentally shift the Identity and Access Management (IAM) model from "human authenticates and acts" to "human delegates and agent acts autonomously." This document presents a comprehensive plan to maintain robust access controls for AI agents, including mechanisms for reviewing and attesting to agent access, and investigating agent actions performed on behalf of users.

The plan addresses eight key areas: agent identity management, scoped delegation, granular access controls, consent and attestation frameworks, comprehensive audit trails, lifecycle management, governance architecture, and alignment with industry standards.

---

## 1. Agent Identity as a First-Class Concept

Treat each AI agent as a distinct identity, not just an extension of the user's session.

### Agent Registration & Credential Issuance

Every agent instance should be registered in your identity provider with its own unique identifier (e.g., `agent:<agentId>` or a service principal). Do not rely solely on the delegating user's credentials.

### Agent Metadata

Store metadata about each agent identity:

- Who created the agent
- What model/version it runs
- What purpose it serves
- When it was provisioned
- Its current lifecycle state (active, suspended, revoked)

### Short-Lived Credentials

Issue agents time-bound tokens (OAuth2 tokens with short TTLs, or certificate-based credentials with auto-rotation). Avoid long-lived API keys. The agent should re-authenticate or refresh frequently.

---

## 2. Scoped Delegation Model (Not Impersonation)

Use constrained delegation rather than full impersonation.

### OAuth2 Token Exchange / On-Behalf-Of (OBO)

When a user delegates to an agent, use a token exchange flow (RFC 8693) that produces a downscoped token. The resulting token should carry:

- **User's identity** — the `sub` or `act` claim ("acting on behalf of")
- **Agent's identity** — the `azp` or a custom `agent_id` claim
- **Explicit scope set** — a subset of the user's permissions

### Permission Boundaries

Define an "agent permission boundary" — a ceiling on what any agent can do, regardless of the delegating user's full entitlements. The effective permissions are the intersection of:

- The user's grants
- The agent's requested scopes
- The boundary policy

### No Privilege Escalation

Agents must never be able to request more access than the delegating user has, and should operate on the principle of least privilege — requesting only what they need for the task at hand.

---

## 3. Granular Access Control Policies

### Resource-Level Policies

Define what resources and actions each agent type can access. Use attribute-based access control (ABAC) or policy-as-code (e.g., OPA/Rego, Cedar) to express rules such as:

- "Agent X can read documents in project Y but cannot delete or share externally"
- "Agent X can send messages but cannot modify channel configurations"
- "Agent X can execute code in sandbox but not access production databases"

### Action Classification / Tiering

Classify actions into tiers:

| Tier | Description | Agent Policy |
|------|-------------|--------------|
| Tier 0 | Read-only operations | Agents can perform freely |
| Tier 1 | Low-risk write operations | Agents can perform with logging |
| Tier 2 | Sensitive operations | Require human-in-the-loop approval before execution |
| Tier 3 | Privileged operations (IAM changes, billing, data exports) | Blocked for agents entirely |

### Contextual Policies

Factor in context when evaluating access decisions: time of day, source IP/network, the specific task the agent is performing, and whether the user is online/available for approval.

---

## 4. Consent and Attestation Framework

### Explicit User Consent

Before an agent gains access, require the user to explicitly grant consent (similar to OAuth consent screens), listing exactly what permissions the agent will have.

### Periodic Access Reviews / Recertification

- On a defined cadence (e.g., quarterly), require users to attest that each of their agents still needs the access it has. Expired attestations should auto-revoke or suspend the agent.
- Manager/admin attestation: for sensitive scopes, require a second-party review.

### Access Review Dashboard

Build a UI where users and admins can see:

- All agents acting on their behalf
- What permissions each agent holds
- When those permissions were last used
- A "Revoke" button for immediate deprovisioning

### Drift Detection

Continuously compare actual agent permissions against approved baselines. Flag drift for review.

---

## 5. Comprehensive Audit Trail

This is arguably the most important piece for investigation and compliance.

### Structured Audit Events

Every action an agent takes should produce an immutable audit log entry containing:

| Field | Description |
|-------|-------------|
| `timestamp` | When the action occurred |
| `agent_id` | The agent's unique identity |
| `delegating_user_id` | Who the agent acts on behalf of |
| `action` | What was done (API call, tool invocation, resource access) |
| `resource` | What was acted upon |
| `input_context` | What prompt/instruction triggered the action (sanitized for PII) |
| `outcome` | Success/failure, response summary |
| `session_id` / `trace_id` | Correlation ID to link actions into a single task |
| `policy_decision` | Which policy allowed or denied the action |

### Immutable, Tamper-Evident Storage

Write audit logs to append-only storage (e.g., a WORM-configured object store, a blockchain-anchored ledger, or a SIEM). Agents must not be able to modify or delete their own logs.

### Session Replay / Investigation

Enable forensic investigation by:

- Linking all actions in a single agent "session" or "task" via a correlation ID
- Storing the full decision chain (what the agent "thought," which tools it called, what results it got)
- Providing search/filter capabilities over audit logs (by user, agent, time range, action type, resource)

### Anomaly Detection

Layer behavioral analytics on top of audit logs to detect unusual agent activity — e.g., an agent suddenly accessing resources it never has before, operating outside normal hours, or performing an abnormal volume of actions.

---

## 6. Lifecycle Management

- **Provisioning:** Tied to a specific user and purpose. Automated where possible (e.g., when a user enables an agent in a product, the IAM provisioning happens behind the scenes).
- **Suspension:** If a user's account is suspended or locked, all their delegated agents must be immediately suspended too.
- **Revocation:** Instant revocation of agent credentials (requires short-lived tokens or a real-time revocation check at enforcement points).
- **Deprovisioning:** When an agent is retired or a user offboards, clean up all agent identities, tokens, and cached credentials.
- **Inheritance:** If a user's role changes (e.g., department transfer), agent permissions should be re-evaluated — not silently carried forward.

---

## 7. Governance & Policy Architecture

At the enterprise level, the following components form the governance framework:

| Layer | Purpose |
|-------|---------|
| Agent Registry | Central catalog of all agent types, their capabilities, and risk classifications |
| Policy Engine | Centralized policy evaluation (OPA, Cedar, or custom) that all enforcement points call |
| Consent Service | Manages user grants, attestation schedules, and revocation |
| Audit Service | Ingests, indexes, and retains all agent activity logs |
| Review / Attestation UI | Dashboards for users, managers, and security teams |
| Anomaly Detection | ML/rule-based detection layered on audit data |

---

## 8. Standards & Frameworks

The following industry standards and frameworks should inform your implementation:

- **OAuth 2.0 Token Exchange (RFC 8693)** — for the delegation flow
- **CAEP (Continuous Access Evaluation Protocol)** — for real-time policy enforcement and session revocation
- **SCIM** — for agent identity provisioning and deprovisioning
- **OpenID AuthZEN** — emerging authorization API standard
- **NIST SP 800-207 (Zero Trust)** — agents should be treated as untrusted by default, verified continuously
- **OWASP Top 10 for LLM Applications** — covers prompt injection, excessive agency, and other agent-specific risks

---

## Summary: Key Principles

1. **Agents are identities, not shadows** — give them their own credentials and track them independently.
2. **Least privilege by default** — agents get only what they need, bounded by what the user has.
3. **Consent is explicit and renewable** — users must grant, review, and re-attest.
4. **Every action is auditable** — immutable, correlated, searchable logs with full context.
5. **Lifecycle is coupled to the user** — if the user's access changes, the agent's access changes.
6. **Human-in-the-loop for sensitive operations** — tier your actions and gate the risky ones.

This plan provides defense in depth: preventive controls (scoped delegation, permission boundaries), detective controls (audit logs, anomaly detection), and corrective controls (revocation, attestation-driven cleanup).
