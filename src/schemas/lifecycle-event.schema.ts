import { z } from 'zod';

export const lifecycleEventTypeEnum = z.enum([
  'user.suspended',
  'user.reactivated',
  'user.departed',
  'user.role_changed',
]);

export const lifecycleEventBodySchema = z.object({
  eventType: lifecycleEventTypeEnum,
  userId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const lifecycleEventResponseSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string(),
  userId: z.string(),
  status: z.string(),
  agentsAffected: z.number(),
  processedAt: z.string(),
});

export type LifecycleEventInput = z.infer<typeof lifecycleEventBodySchema>;
