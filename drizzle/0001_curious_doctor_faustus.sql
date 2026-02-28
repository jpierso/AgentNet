CREATE TABLE "agent_suspension_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"previous_state" text NOT NULL,
	"suspended_by_event" uuid NOT NULL,
	"reactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_scopes" jsonb NOT NULL,
	"granted_permissions" jsonb NOT NULL,
	"parent_token_jti" text NOT NULL,
	"ttl_minutes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_status_check" CHECK ("approval_requests"."status" IN ('pending', 'approved', 'denied', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "attestation_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"frequency" text NOT NULL,
	"scope" text NOT NULL,
	"scope_filter" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_frequency_check" CHECK ("attestation_campaigns"."frequency" IN ('quarterly', 'semi_annual', 'annual', 'ad_hoc')),
	CONSTRAINT "campaign_scope_check" CHECK ("attestation_campaigns"."scope" IN ('all_agents', 'sensitive_only', 'specific_agents')),
	CONSTRAINT "campaign_status_check" CHECK ("attestation_campaigns"."status" IN ('active', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "attestation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"permission_id" uuid NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"reviewer_role" text NOT NULL,
	"permission_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_reviewer_role_check" CHECK ("attestation_items"."reviewer_role" IN ('owner', 'manager', 'security_delegate')),
	CONSTRAINT "item_status_check" CHECK ("attestation_items"."status" IN ('pending', 'attested', 'rejected', 'auto_suspended')),
	CONSTRAINT "item_decision_check" CHECK ("attestation_items"."decision" IS NULL OR "attestation_items"."decision" IN ('confirm', 'revoke'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" text NOT NULL,
	"span_id" text,
	"parent_span_id" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_type" text NOT NULL,
	"outcome" text NOT NULL,
	"outcome_reason" text,
	"metadata" jsonb,
	"request_method" text,
	"request_path" text,
	"request_id" text,
	"status_code" integer,
	"duration_ms" integer,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "actor_type_check" CHECK ("audit_events"."actor_type" IN ('agent', 'user', 'system')),
	CONSTRAINT "outcome_check" CHECK ("audit_events"."outcome" IN ('success', 'failure', 'denied'))
);
--> statement-breakpoint
CREATE TABLE "audit_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blockchain_tx_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"span_id" text,
	"parent_span_id" text,
	"timestamp" timestamp with time zone NOT NULL,
	"agent_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_type" text NOT NULL,
	"outcome" text NOT NULL,
	"outcome_reason" text,
	"metadata" jsonb,
	"request_method" text,
	"request_path" text,
	"request_id" text,
	"status_code" integer,
	"duration_ms" integer,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_index_blockchain_tx_id_unique" UNIQUE("blockchain_tx_id"),
	CONSTRAINT "audit_index_actor_type_check" CHECK ("audit_index"."actor_type" IN ('agent', 'user', 'system')),
	CONSTRAINT "audit_index_outcome_check" CHECK ("audit_index"."outcome" IN ('success', 'failure', 'denied'))
);
--> statement-breakpoint
CREATE TABLE "consent_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permission_snapshot" jsonb NOT NULL,
	"scopes" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_status_check" CHECK ("consent_grants"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'processed' NOT NULL,
	"agents_affected" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_event_type_check" CHECK ("lifecycle_events"."event_type" IN ('user.suspended', 'user.reactivated', 'user.departed', 'user.role_changed')),
	CONSTRAINT "lifecycle_event_status_check" CHECK ("lifecycle_events"."status" IN ('processed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "permission_boundaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"resource" text NOT NULL,
	"allowed_actions" jsonb NOT NULL,
	"action_tier" text NOT NULL,
	"conditions" jsonb,
	"granted_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_tier_check" CHECK ("permission_boundaries"."action_tier" IN ('tier_0', 'tier_1', 'tier_2', 'tier_3'))
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"resource_pattern" text NOT NULL,
	"action_pattern" text NOT NULL,
	"agent_type_pattern" text,
	"tier" text,
	"conditions" jsonb,
	"effect" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_rules_name_unique" UNIQUE("name"),
	CONSTRAINT "tier_check" CHECK ("policy_rules"."tier" IS NULL OR "policy_rules"."tier" IN ('tier_0', 'tier_1', 'tier_2', 'tier_3')),
	CONSTRAINT "effect_check" CHECK ("policy_rules"."effect" IN ('allow', 'deny', 'require_approval'))
);
--> statement-breakpoint
CREATE TABLE "token_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jti" text NOT NULL,
	"agent_id" text NOT NULL,
	"parent_jti" text,
	"revoked_by" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_revocations_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
ALTER TABLE "agent_identities" DROP CONSTRAINT "lifecycle_state_check";--> statement-breakpoint
ALTER TABLE "agent_suspension_records" ADD CONSTRAINT "agent_suspension_records_agent_id_agent_identities_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suspension_records" ADD CONSTRAINT "agent_suspension_records_suspended_by_event_lifecycle_events_id_fk" FOREIGN KEY ("suspended_by_event") REFERENCES "public"."lifecycle_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_id_agent_identities_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestation_items" ADD CONSTRAINT "attestation_items_campaign_id_attestation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."attestation_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestation_items" ADD CONSTRAINT "attestation_items_agent_id_agent_identities_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_agent_id_agent_identities_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_boundaries" ADD CONSTRAINT "permission_boundaries_agent_id_agent_identities_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_revocations" ADD CONSTRAINT "token_revocations_agent_id_agent_identities_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suspension_agent_idx" ON "agent_suspension_records" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "suspension_event_idx" ON "agent_suspension_records" USING btree ("suspended_by_event");--> statement-breakpoint
CREATE INDEX "approval_agent_status_idx" ON "approval_requests" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "approval_status_expires_idx" ON "approval_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "campaign_status_due_idx" ON "attestation_campaigns" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "item_campaign_idx" ON "attestation_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "item_agent_idx" ON "attestation_items" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "item_reviewer_status_idx" ON "attestation_items" USING btree ("reviewer_user_id","status");--> statement-breakpoint
CREATE INDEX "item_campaign_status_idx" ON "attestation_items" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "audit_trace_id_idx" ON "audit_events" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "audit_agent_id_idx" ON "audit_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_timestamp_idx" ON "audit_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_agent_timestamp_idx" ON "audit_events" USING btree ("agent_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_index_trace_id_idx" ON "audit_index" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "audit_index_agent_id_idx" ON "audit_index" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "audit_index_action_idx" ON "audit_index" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_index_timestamp_idx" ON "audit_index" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_index_agent_timestamp_idx" ON "audit_index" USING btree ("agent_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_index_blockchain_tx_id_idx" ON "audit_index" USING btree ("blockchain_tx_id");--> statement-breakpoint
CREATE INDEX "consent_agent_user_idx" ON "consent_grants" USING btree ("agent_id","user_id");--> statement-breakpoint
CREATE INDEX "consent_user_idx" ON "consent_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "consent_status_idx" ON "consent_grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lifecycle_event_user_idx" ON "lifecycle_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lifecycle_event_type_idx" ON "lifecycle_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "lifecycle_event_created_idx" ON "lifecycle_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "perm_agent_resource_tier_idx" ON "permission_boundaries" USING btree ("agent_id","resource","action_tier");--> statement-breakpoint
CREATE INDEX "policy_enabled_priority_idx" ON "policy_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "token_revocation_jti_idx" ON "token_revocations" USING btree ("jti");--> statement-breakpoint
CREATE INDEX "token_revocation_agent_idx" ON "token_revocations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "token_revocation_parent_jti_idx" ON "token_revocations" USING btree ("parent_jti");--> statement-breakpoint
CREATE INDEX "token_revocation_expires_idx" ON "token_revocations" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "lifecycle_state_check" CHECK ("agent_identities"."lifecycle_state" IN ('active', 'suspended', 'revoked', 'deprovisioned'));