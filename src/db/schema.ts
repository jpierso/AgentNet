import { pgTable, uuid, text, timestamp, check, jsonb, integer, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
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

// --- Phase 3: Policy Rules ---

export const policyRules = pgTable(
  'policy_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    resourcePattern: text('resource_pattern').notNull(),
    actionPattern: text('action_pattern').notNull(),
    agentTypePattern: text('agent_type_pattern'),
    tier: text('tier'),
    conditions: jsonb('conditions').$type<Record<string, unknown>>(),
    effect: text('effect').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'tier_check',
      sql`${table.tier} IS NULL OR ${table.tier} IN ('tier_0', 'tier_1', 'tier_2', 'tier_3')`,
    ),
    check(
      'effect_check',
      sql`${table.effect} IN ('allow', 'deny', 'require_approval')`,
    ),
    index('policy_enabled_priority_idx').on(table.enabled),
  ],
);

export type PolicyRule = typeof policyRules.$inferSelect;
export type NewPolicyRule = typeof policyRules.$inferInsert;

// --- Phase 3: Approval Requests ---

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentIdentities.agentId, { onDelete: 'cascade' }),
    requestedBy: text('requested_by').notNull(),
    requestedScopes: jsonb('requested_scopes').notNull().$type<string[]>(),
    grantedPermissions: jsonb('granted_permissions')
      .notNull()
      .$type<Array<{ resource: string; actions: string[]; tier: string }>>(),
    parentTokenJti: text('parent_token_jti').notNull(),
    ttlMinutes: integer('ttl_minutes').notNull(),
    status: text('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'approval_status_check',
      sql`${table.status} IN ('pending', 'approved', 'denied', 'expired')`,
    ),
    index('approval_agent_status_idx').on(table.agentId, table.status),
    index('approval_status_expires_idx').on(table.status, table.expiresAt),
  ],
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;

// --- Phase 4: Consent & Attestation ---

export const consentGrants = pgTable(
  'consent_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentIdentities.agentId, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    permissionSnapshot: jsonb('permission_snapshot').notNull().$type<Record<string, unknown>[]>(),
    scopes: jsonb('scopes').notNull().$type<string[]>(),
    status: text('status').notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'consent_status_check',
      sql`${table.status} IN ('active', 'revoked')`,
    ),
    index('consent_agent_user_idx').on(table.agentId, table.userId),
    index('consent_user_idx').on(table.userId),
    index('consent_status_idx').on(table.status),
  ],
);

export type ConsentGrant = typeof consentGrants.$inferSelect;
export type NewConsentGrant = typeof consentGrants.$inferInsert;

export const attestationCampaigns = pgTable(
  'attestation_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    frequency: text('frequency').notNull(),
    scope: text('scope').notNull(),
    scopeFilter: jsonb('scope_filter').$type<{ agentIds?: string[]; ownerUserIds?: string[]; minTier?: string }>(),
    status: text('status').notNull().default('active'),
    createdBy: text('created_by').notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'campaign_frequency_check',
      sql`${table.frequency} IN ('quarterly', 'semi_annual', 'annual', 'ad_hoc')`,
    ),
    check(
      'campaign_scope_check',
      sql`${table.scope} IN ('all_agents', 'sensitive_only', 'specific_agents')`,
    ),
    check(
      'campaign_status_check',
      sql`${table.status} IN ('active', 'completed', 'cancelled')`,
    ),
    index('campaign_status_due_idx').on(table.status, table.dueDate),
  ],
);

export type AttestationCampaign = typeof attestationCampaigns.$inferSelect;
export type NewAttestationCampaign = typeof attestationCampaigns.$inferInsert;

export const attestationItems = pgTable(
  'attestation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => attestationCampaigns.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentIdentities.agentId, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id').notNull(),
    reviewerUserId: text('reviewer_user_id').notNull(),
    reviewerRole: text('reviewer_role').notNull(),
    permissionSnapshot: jsonb('permission_snapshot').notNull().$type<Record<string, unknown>>(),
    status: text('status').notNull().default('pending'),
    decision: text('decision'),
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'item_reviewer_role_check',
      sql`${table.reviewerRole} IN ('owner', 'manager', 'security_delegate')`,
    ),
    check(
      'item_status_check',
      sql`${table.status} IN ('pending', 'attested', 'rejected', 'auto_suspended')`,
    ),
    check(
      'item_decision_check',
      sql`${table.decision} IS NULL OR ${table.decision} IN ('confirm', 'revoke')`,
    ),
    index('item_campaign_idx').on(table.campaignId),
    index('item_agent_idx').on(table.agentId),
    index('item_reviewer_status_idx').on(table.reviewerUserId, table.status),
    index('item_campaign_status_idx').on(table.campaignId, table.status),
  ],
);

export type AttestationItem = typeof attestationItems.$inferSelect;
export type NewAttestationItem = typeof attestationItems.$inferInsert;
