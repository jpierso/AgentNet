import { z } from 'zod';

export const campaignFrequencyEnum = z.enum(['quarterly', 'semi_annual', 'annual', 'ad_hoc']);
export const campaignScopeEnum = z.enum(['all_agents', 'sensitive_only', 'specific_agents']);
export const campaignStatusEnum = z.enum(['active', 'completed', 'cancelled']);
export const itemStatusEnum = z.enum(['pending', 'attested', 'rejected', 'auto_suspended']);
export const reviewerRoleEnum = z.enum(['owner', 'manager', 'security_delegate']);
export const itemDecisionEnum = z.enum(['confirm', 'revoke']);

// --- Request schemas ---

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  frequency: campaignFrequencyEnum,
  scope: campaignScopeEnum,
  scopeFilter: z.object({
    agentIds: z.array(z.string()).optional(),
    ownerUserIds: z.array(z.string()).optional(),
    minTier: z.string().optional(),
  }).optional(),
  createdBy: z.string().uuid(),
  dueDate: z.string().datetime(),
});

export const campaignIdParamSchema = z.object({
  campaignId: z.string().uuid(),
});

export const campaignQuerySchema = z.object({
  status: campaignStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const itemIdParamSchema = z.object({
  itemId: z.string().uuid(),
});

export const itemQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  reviewerUserId: z.string().uuid().optional(),
  agentId: z.string().optional(),
  status: itemStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reviewItemSchema = z.object({
  decision: itemDecisionEnum,
  decisionNote: z.string().max(1000).optional(),
  reviewerUserId: z.string().uuid(),
});

// --- Response schemas ---

export const campaignResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  frequency: campaignFrequencyEnum,
  scope: campaignScopeEnum,
  scopeFilter: z.record(z.string(), z.unknown()).nullable(),
  status: campaignStatusEnum,
  createdBy: z.string(),
  dueDate: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const campaignListResponseSchema = z.object({
  data: z.array(campaignResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const campaignProgressSchema = z.object({
  campaignId: z.string().uuid(),
  total: z.number(),
  pending: z.number(),
  attested: z.number(),
  rejected: z.number(),
  autoSuspended: z.number(),
});

export const itemResponseSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  agentId: z.string(),
  permissionId: z.string().uuid(),
  reviewerUserId: z.string(),
  reviewerRole: reviewerRoleEnum,
  permissionSnapshot: z.record(z.string(), z.unknown()),
  status: itemStatusEnum,
  decision: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const itemListResponseSchema = z.object({
  data: z.array(itemResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type ReviewItemInput = z.infer<typeof reviewItemSchema>;
export type CampaignResponse = z.infer<typeof campaignResponseSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
