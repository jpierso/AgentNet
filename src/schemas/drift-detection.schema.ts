import { z } from 'zod';

// --- Request schemas ---

export const driftAgentParamSchema = z.object({
  agentId: z.string().min(1),
});

export const driftQuerySchema = z.object({
  ownerUserId: z.string().uuid().optional(),
});

// --- Response schemas ---

const driftItemSchema = z.object({
  permissionId: z.string().uuid().nullable(),
  resource: z.string(),
  driftType: z.enum(['added', 'removed', 'modified']),
  baseline: z.record(z.string(), z.unknown()).nullable(),
  current: z.record(z.string(), z.unknown()).nullable(),
});

export const agentDriftResponseSchema = z.object({
  agentId: z.string(),
  hasDrift: z.boolean(),
  drifts: z.array(driftItemSchema),
  baselineCampaignId: z.string().uuid().nullable(),
  detectedAt: z.string(),
});

export const batchDriftResponseSchema = z.object({
  agents: z.array(agentDriftResponseSchema),
  detectedAt: z.string(),
});

export type AgentDriftResponse = z.infer<typeof agentDriftResponseSchema>;
export type DriftItem = z.infer<typeof driftItemSchema>;
