import { z } from 'zod';

export const approvalIdParamSchema = z.object({
  approvalId: z.string().uuid(),
});

export const reviewApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  reviewedBy: z.string().min(1),
  note: z.string().max(1000).optional(),
});

export const approvalResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  requestedBy: z.string(),
  requestedScopes: z.array(z.string()),
  grantedPermissions: z.array(z.object({
    resource: z.string(),
    actions: z.array(z.string()),
    tier: z.string(),
  })),
  parentTokenJti: z.string(),
  ttlMinutes: z.number(),
  status: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type ReviewApprovalInput = z.infer<typeof reviewApprovalSchema>;
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;
