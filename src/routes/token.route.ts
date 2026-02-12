import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentService } from '../services/agent.service.js';
import { StubIdentityProvider } from '../services/stub-identity-provider.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import {
  issueTokenParamSchema,
  issueTokenBodySchema,
  tokenResponseSchema,
} from '../schemas/token.schema.js';
import { env } from '../config/env.js';

export async function tokenRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const agentService = new AgentService(app.db);
  const idp = new StubIdentityProvider();

  // POST /agents/:agentId/token — Issue short-lived token
  typedApp.route({
    method: 'POST',
    url: '/:agentId/token',
    schema: {
      params: issueTokenParamSchema,
      body: issueTokenBodySchema,
      response: { 200: tokenResponseSchema },
    },
    handler: async (request, reply) => {
      const agent = await agentService.getByAgentId(request.params.agentId);
      const ttl = request.body?.ttlMinutes ?? env.JWT_TTL_MINUTES;
      const token = await idp.issueToken(agent, ttl);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: agent.ownerUserId,
        action: AuditActions.TOKEN_ISSUED,
        resource: `token:${agent.agentId}`,
        resourceType: ResourceTypes.TOKEN,
        outcome: Outcomes.SUCCESS,
        agentId: agent.agentId,
        metadata: { ttlMinutes: ttl },
      });

      return reply.send(token);
    },
  });
}
