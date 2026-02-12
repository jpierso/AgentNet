import { z } from 'zod';

export const lifecycleStateEnum = z.enum(['active', 'suspended', 'revoked', 'deprovisioned']);

// --- Request schemas ---

export const createAgentSchema = z.object({
  agentId: z.string().min(1).max(255),
  ownerUserId: z.string().uuid(),
  managerUserId: z.string().uuid(),
  agentType: z.string().min(1).max(100),
  modelVersion: z.string().max(50).optional(),
  purpose: z.string().max(500).optional(),
  oktaClientId: z.string().max(255).optional(),
});

export const updateAgentSchema = z.object({
  managerUserId: z.string().uuid().optional(),
  agentType: z.string().min(1).max(100).optional(),
  modelVersion: z.string().max(50).optional(),
  purpose: z.string().max(500).optional(),
  lifecycleState: lifecycleStateEnum.optional(),
  oktaClientId: z.string().max(255).optional(),
});

export const agentIdParamSchema = z.object({
  agentId: z.string().min(1),
});

export const agentQuerySchema = z.object({
  ownerUserId: z.string().uuid().optional(),
  managerUserId: z.string().uuid().optional(),
  lifecycleState: lifecycleStateEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- Response schemas ---

export const agentResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  ownerUserId: z.string(),
  managerUserId: z.string(),
  agentType: z.string(),
  modelVersion: z.string().nullable(),
  purpose: z.string().nullable(),
  lifecycleState: lifecycleStateEnum,
  oktaClientId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const agentListResponseSchema = z.object({
  data: z.array(agentResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
