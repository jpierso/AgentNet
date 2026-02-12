import { z } from 'zod';

export const actionTierEnum = z.enum(['tier_0', 'tier_1', 'tier_2', 'tier_3']);
export const effectEnum = z.enum(['allow', 'deny', 'require_approval']);

const conditionsSchema = z.object({
  allowed_hours: z.object({ start: z.string(), end: z.string() }).optional(),
  allowed_days: z.array(z.string()).optional(),
  allowed_ips: z.array(z.string()).optional(),
  denied_ips: z.array(z.string()).optional(),
}).passthrough().optional();

// --- Request schemas ---

export const createPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(0),
  resourcePattern: z.string().min(1).max(255),
  actionPattern: z.string().min(1).max(255),
  agentTypePattern: z.string().max(255).optional(),
  tier: actionTierEnum.optional(),
  conditions: conditionsSchema,
  effect: effectEnum,
});

export const updatePolicySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  resourcePattern: z.string().min(1).max(255).optional(),
  actionPattern: z.string().min(1).max(255).optional(),
  agentTypePattern: z.string().max(255).nullable().optional(),
  tier: actionTierEnum.nullable().optional(),
  conditions: conditionsSchema.nullable(),
  effect: effectEnum.optional(),
});

export const policyIdParamSchema = z.object({
  policyId: z.string().uuid(),
});

export const policyQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
  resourcePattern: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const evaluatePolicySchema = z.object({
  agentId: z.string().min(1),
  agentType: z.string().min(1),
  resource: z.string().min(1),
  action: z.string().min(1),
  actionTier: actionTierEnum,
  ipAddress: z.string().optional(),
});

// --- Response schemas ---

export const policyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  priority: z.number(),
  resourcePattern: z.string(),
  actionPattern: z.string(),
  agentTypePattern: z.string().nullable(),
  tier: z.string().nullable(),
  conditions: z.record(z.string(), z.unknown()).nullable(),
  effect: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const policyListResponseSchema = z.object({
  data: z.array(policyResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const policyDecisionResponseSchema = z.object({
  effect: z.enum(['allow', 'deny', 'require_approval']),
  matchedRules: z.array(z.object({
    ruleId: z.string(),
    name: z.string(),
    effect: z.string(),
  })),
  reasons: z.array(z.string()),
});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type PolicyResponse = z.infer<typeof policyResponseSchema>;
