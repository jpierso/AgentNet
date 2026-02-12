import { z } from 'zod';

export const issueTokenParamSchema = z.object({
  agentId: z.string().min(1),
});

export const issueTokenBodySchema = z.object({
  ttlMinutes: z.number().int().min(1).max(60).default(15),
});

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
  expiresAt: z.string(),
});

export type IssueTokenInput = z.infer<typeof issueTokenBodySchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
