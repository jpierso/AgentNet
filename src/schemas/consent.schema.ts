import { z } from 'zod';

export const consentStatusEnum = z.enum(['active', 'revoked']);

// --- Request schemas ---

export const createConsentSchema = z.object({
  agentId: z.string().min(1),
  userId: z.string().uuid(),
  scopes: z.array(z.string().min(1)).min(1),
});

export const consentIdParamSchema = z.object({
  consentId: z.string().uuid(),
});

export const consentQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  agentId: z.string().optional(),
  status: consentStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- Response schemas ---

export const consentResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  userId: z.string(),
  permissionSnapshot: z.array(z.record(z.string(), z.unknown())),
  scopes: z.array(z.string()),
  status: consentStatusEnum,
  revokedAt: z.string().nullable(),
  revokedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const consentListResponseSchema = z.object({
  data: z.array(consentResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type CreateConsentInput = z.infer<typeof createConsentSchema>;
export type ConsentResponse = z.infer<typeof consentResponseSchema>;
