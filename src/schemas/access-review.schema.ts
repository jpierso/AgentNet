import { z } from 'zod';

// --- Request schemas ---

export const accessReviewUserParamSchema = z.object({
  userId: z.string().uuid(),
});

// --- Response schemas ---

const permissionSummarySchema = z.object({
  id: z.string().uuid(),
  resource: z.string(),
  allowedActions: z.array(z.string()),
  actionTier: z.string(),
  expiresAt: z.string().nullable(),
  lastUsed: z.string().nullable(),
});

const consentSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
});

const agentAccessSummarySchema = z.object({
  agentId: z.string(),
  agentType: z.string(),
  lifecycleState: z.string(),
  permissions: z.array(permissionSummarySchema),
  consents: z.array(consentSummarySchema),
});

export const accessReviewResponseSchema = z.object({
  userId: z.string(),
  agents: z.array(agentAccessSummarySchema),
  reviewedAt: z.string(),
});

export type AccessReviewResponse = z.infer<typeof accessReviewResponseSchema>;
export type AgentAccessSummary = z.infer<typeof agentAccessSummarySchema>;
