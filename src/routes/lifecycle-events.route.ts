import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LifecycleService } from '../services/lifecycle.service.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import { env } from '../config/env.js';
import {
  lifecycleEventBodySchema,
  lifecycleEventResponseSchema,
} from '../schemas/lifecycle-event.schema.js';

export async function lifecycleEventsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const lifecycleService = new LifecycleService(app.db, app.revocationSet);

  // POST /lifecycle-events
  typedApp.route({
    method: 'POST',
    url: '/',
    schema: {
      body: lifecycleEventBodySchema,
      response: { 200: lifecycleEventResponseSchema },
    },
    handler: async (request, reply) => {
      // Authenticate webhook via shared secret
      const secret = request.headers['x-webhook-secret'];
      if (!secret || secret !== env.WEBHOOK_SECRET) {
        throw new AppError(401, 'Unauthorized', 'Invalid or missing webhook secret');
      }

      const { eventType, userId, payload } = request.body;

      const result = await lifecycleService.processEvent({
        eventType,
        userId,
        payload,
      });

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.SYSTEM,
        actorId: `lifecycle:${eventType}`,
        action: AuditActions.LIFECYCLE_EVENT_PROCESSED,
        resource: `lifecycle:${result.event.id}`,
        resourceType: ResourceTypes.LIFECYCLE_EVENT,
        outcome: Outcomes.SUCCESS,
        metadata: {
          eventType,
          userId,
          agentsAffected: result.agentsAffected,
        },
      });

      return reply.send({
        eventId: result.event.id,
        eventType: result.event.eventType,
        userId: result.event.userId,
        status: result.event.status,
        agentsAffected: result.agentsAffected,
        processedAt: result.event.processedAt.toISOString(),
      });
    },
  });
}
