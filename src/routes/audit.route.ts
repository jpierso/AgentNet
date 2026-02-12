import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AuditEvent } from '../db/schema.js';
import type { AuditEventResponse } from '../schemas/audit.schema.js';
import {
  auditQuerySchema,
  traceIdParamSchema,
  auditListResponseSchema,
  auditTraceResponseSchema,
} from '../schemas/audit.schema.js';

function formatAuditEvent(e: AuditEvent): AuditEventResponse {
  return {
    id: e.id,
    traceId: e.traceId,
    spanId: e.spanId,
    parentSpanId: e.parentSpanId,
    timestamp: e.timestamp.toISOString(),
    agentId: e.agentId,
    actorType: e.actorType,
    actorId: e.actorId,
    action: e.action,
    resource: e.resource,
    resourceType: e.resourceType,
    outcome: e.outcome,
    outcomeReason: e.outcomeReason,
    metadata: (e.metadata as Record<string, unknown>) ?? null,
    requestMethod: e.requestMethod,
    requestPath: e.requestPath,
    requestId: e.requestId,
    statusCode: e.statusCode,
    durationMs: e.durationMs,
    ipAddress: e.ipAddress,
    userAgent: e.userAgent,
  };
}

export async function auditRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // GET /audit-events — Query audit events
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: auditQuerySchema,
      response: { 200: auditListResponseSchema },
    },
    handler: async (request, reply) => {
      const q = request.query;
      const result = await app.auditService.query({
        agentId: q.agentId,
        actorId: q.actorId,
        actorType: q.actorType,
        action: q.action,
        resourceType: q.resourceType,
        outcome: q.outcome,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        limit: q.limit,
        offset: q.offset,
      });
      return reply.send({
        data: result.data.map(formatAuditEvent),
        total: result.total,
        limit: q.limit,
        offset: q.offset,
      });
    },
  });

  // GET /audit-events/trace/:traceId — Session replay by trace
  typedApp.route({
    method: 'GET',
    url: '/trace/:traceId',
    schema: {
      params: traceIdParamSchema,
      response: { 200: auditTraceResponseSchema },
    },
    handler: async (request, reply) => {
      const events = await app.auditService.getTrace(request.params.traceId);
      return reply.send({
        traceId: request.params.traceId,
        events: events.map(formatAuditEvent),
      });
    },
  });
}
