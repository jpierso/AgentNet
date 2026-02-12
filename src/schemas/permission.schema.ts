import { z } from 'zod';

export const actionTierEnum = z.enum(['tier_0', 'tier_1', 'tier_2', 'tier_3']);

// --- Request schemas ---

export const createPermissionSchema = z.object({
  agentId: z.string().min(1),
  resource: z.string().min(1).max(255),
  allowedActions: z.array(z.string().min(1).max(100)).min(1),
  actionTier: actionTierEnum,
  conditions: z.record(z.string(), z.unknown()).optional(),
  grantedBy: z.string().uuid(),
  expiresAt: z.string().datetime().optional(),
});

export const updatePermissionSchema = z.object({
  allowedActions: z.array(z.string().min(1).max(100)).min(1).optional(),
  actionTier: actionTierEnum.optional(),
  conditions: z.record(z.string(), z.unknown()).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const permissionIdParamSchema = z.object({
  permissionId: z.string().uuid(),
});

export const agentPermissionsParamSchema = z.object({
  agentId: z.string().min(1),
});

export const permissionQuerySchema = z.object({
  agentId: z.string().optional(),
  resource: z.string().optional(),
  actionTier: actionTierEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- Response schemas ---

export const permissionResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  resource: z.string(),
  allowedActions: z.array(z.string()),
  actionTier: actionTierEnum,
  conditions: z.record(z.string(), z.unknown()).nullable(),
  grantedBy: z.string(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const permissionListResponseSchema = z.object({
  data: z.array(permissionResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;
export type UpdatePermissionInput = z.infer<typeof updatePermissionSchema>;
export type PermissionResponse = z.infer<typeof permissionResponseSchema>;
