CREATE TABLE "agent_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"manager_user_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"model_version" text,
	"purpose" text,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"okta_client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identities_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "lifecycle_state_check" CHECK ("agent_identities"."lifecycle_state" IN ('active', 'suspended', 'revoked'))
);
