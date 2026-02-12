import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';

export const auditHookPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onResponse', async (request, reply) => {
    // Skip health checks to avoid noise
    if (request.url === '/health') return;

    const statusCode = reply.statusCode;
    const outcome = statusCode >= 400
      ? (statusCode === 403 ? Outcomes.DENIED : Outcomes.FAILURE)
      : Outcomes.SUCCESS;

    try {
      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.SYSTEM,
        actorId: 'http-hook',
        action: AuditActions.HTTP_REQUEST,
        resource: `${request.method} ${request.url}`,
        resourceType: ResourceTypes.HTTP,
        outcome,
        requestMethod: request.method,
        requestPath: request.url,
        requestId: request.id,
        statusCode,
        durationMs: Math.round(reply.elapsedTime),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? undefined,
      });
    } catch (err) {
      // Never let audit failures break the response
      request.log.error({ err }, 'Failed to record audit event');
    }
  });
});
