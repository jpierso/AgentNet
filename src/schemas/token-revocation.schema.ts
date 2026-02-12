import { z } from 'zod';

// --- Revoke request/response ---

export const revokeTokenBodySchema = z.object({
  jti: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  revokedBy: z.string().min(1),
  reason: z.string().min(1).max(500),
}).refine((data) => data.jti || data.agentId, {
  message: 'Either jti or agentId must be provided',
});

export const revokeTokenResponseSchema = z.object({
  revoked: z.boolean(),
  jti: z.string().optional(),
  agentId: z.string().optional(),
  type: z.enum(['single', 'blanket']),
});

// --- Introspect request/response ---

export const introspectTokenBodySchema = z.object({
  token: z.string().min(1),
});

export const introspectTokenResponseSchema = z.object({
  active: z.boolean(),
  agentId: z.string().optional(),
  ownerUserId: z.string().optional(),
  managerUserId: z.string().optional(),
  agentType: z.string().optional(),
  scope: z.array(z.string()).optional(),
  tokenType: z.string().optional(),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  revoked: z.boolean().optional(),
  agentState: z.string().optional(),
});

export type RevokeTokenInput = z.infer<typeof revokeTokenBodySchema>;
export type IntrospectTokenInput = z.infer<typeof introspectTokenBodySchema>;
