import { z } from 'zod';

export const tokenExchangeParamSchema = z.object({
  agentId: z.string().min(1),
});

export const tokenExchangeBodySchema = z.object({
  grant_type: z.literal('urn:ietf:params:oauth:grant-type:token-exchange'),
  subject_token: z.string().min(1),
  subject_token_type: z.literal('urn:ietf:params:oauth:token-type:access_token'),
  scope: z.array(z.string().min(1)).min(1),
  ttlMinutes: z.number().int().min(1).max(60).default(15),
});

export const tokenExchangeResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
  expiresAt: z.string(),
  scope: z.array(z.string()),
  tokenKind: z.literal('downscoped'),
});

export type TokenExchangeInput = z.infer<typeof tokenExchangeBodySchema>;
export type TokenExchangeResponse = z.infer<typeof tokenExchangeResponseSchema>;
