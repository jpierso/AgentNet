import { pgTable, uuid, text, timestamp, check, jsonb, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const agentIdentities = pgTable(
  'agent_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: text('agent_id').notNull().unique(),
    ownerUserId: text('owner_user_id').notNull(),
    managerUserId: text('manager_user_id').notNull(),
    agentType: text('agent_type').notNull(),
    modelVersion: text('model_version'),
    purpose: text('purpose'),
    lifecycleState: text('lifecycle_state').notNull().default('active'),
    oktaClientId: text('okta_client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'lifecycle_state_check',
      sql`${table.lifecycleState} IN ('active', 'suspended', 'revoked')`,
    ),
  ],
);

export type AgentIdentity = typeof agentIdentities.$inferSelect;
export type NewAgentIdentity = typeof agentIdentities.$inferInsert;

// --- Phase 1: Permission Boundaries ---

export const permissionBoundaries = pgTable(
  'permission_boundaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentIdentities.agentId, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    allowedActions: jsonb('allowed_actions').notNull().$type<string[]>(),
    actionTier: text('action_tier').notNull(),
    conditions: jsonb('conditions').$type<Record<string, unknown>>(),
    grantedBy: text('granted_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'action_tier_check',
      sql`${table.actionTier} IN ('tier_0', 'tier_1', 'tier_2', 'tier_3')`,
    ),
    uniqueIndex('perm_agent_resource_tier_idx').on(
      table.agentId,
      table.resource,
      table.actionTier,
    ),
  ],
);

export type PermissionBoundary = typeof permissionBoundaries.$inferSelect;
export type NewPermissionBoundary = typeof permissionBoundaries.$inferInsert;

// --- Phase 2: Audit Events ---

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: text('trace_id').notNull(),
    spanId: text('span_id'),
    parentSpanId: text('parent_span_id'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    agentId: text('agent_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceType: text('resource_type').notNull(),
    outcome: text('outcome').notNull(),
    outcomeReason: text('outcome_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    requestMethod: text('request_method'),
    requestPath: text('request_path'),
    requestId: text('request_id'),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    check(
      'actor_type_check',
      sql`${table.actorType} IN ('agent', 'user', 'system')`,
    ),
    check(
      'outcome_check',
      sql`${table.outcome} IN ('success', 'failure', 'denied')`,
    ),
    index('audit_trace_id_idx').on(table.traceId),
    index('audit_agent_id_idx').on(table.agentId),
    index('audit_action_idx').on(table.action),
    index('audit_timestamp_idx').on(table.timestamp),
    index('audit_agent_timestamp_idx').on(table.agentId, table.timestamp),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
