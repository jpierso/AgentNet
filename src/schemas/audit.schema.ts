import { z } from 'zod';

export const auditQuerySchema = z.object({
  agentId: z.string().optional(),
  actorId: z.string().optional(),
  actorType: z.enum(['agent', 'user', 'system']).optional(),
  action: z.string().optional(),
  resourceType: z.enum(['agent', 'permission', 'token', 'http']).optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const traceIdParamSchema = z.object({
  traceId: z.string().min(1),
});

export const auditEventResponseSchema = z.object({
  id: z.string().uuid(),
  traceId: z.string(),
  spanId: z.string().nullable(),
  parentSpanId: z.string().nullable(),
  timestamp: z.string(),
  agentId: z.string().nullable(),
  actorType: z.string(),
  actorId: z.string(),
  action: z.string(),
  resource: z.string(),
  resourceType: z.string(),
  outcome: z.string(),
  outcomeReason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  requestMethod: z.string().nullable(),
  requestPath: z.string().nullable(),
  requestId: z.string().nullable(),
  statusCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export const auditListResponseSchema = z.object({
  data: z.array(auditEventResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const auditTraceResponseSchema = z.object({
  traceId: z.string(),
  events: z.array(auditEventResponseSchema),
});

export type AuditEventResponse = z.infer<typeof auditEventResponseSchema>;
