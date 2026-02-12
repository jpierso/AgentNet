import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentService } from '../services/agent.service.js';
import { PermissionService } from '../services/permission.service.js';
import { StubIdentityProvider } from '../services/stub-identity-provider.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import {
  tokenExchangeParamSchema,
  tokenExchangeBodySchema,
  tokenExchangeResponseSchema,
} from '../schemas/token-exchange.schema.js';

export async function tokenExchangeRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const agentService = new AgentService(app.db);
  const permissionService = new PermissionService(app.db);
  const idp = new StubIdentityProvider();

  // POST /agents/:agentId/token/exchange
  typedApp.route({
    method: 'POST',
    url: '/:agentId/token/exchange',
    schema: {
      params: tokenExchangeParamSchema,
      body: tokenExchangeBodySchema,
      response: { 200: tokenExchangeResponseSchema },
    },
    handler: async (request, reply) => {
      const { agentId } = request.params;
      const { subject_token, scope, ttlMinutes } = request.body;

      // 1. Verify subject_token
      const parentClaims = await idp.verifyToken(subject_token);

      // 2. Confirm token's agent_id matches URL :agentId
      if (parentClaims.agent_id !== agentId) {
        throw new AppError(
          403,
          'Forbidden',
          `Token agent_id '${parentClaims.agent_id}' does not match URL agentId '${agentId}'`,
        );
      }

      // 3. Confirm agent is still active
      const agent = await agentService.getByAgentId(agentId);
      if (agent.lifecycleState !== 'active') {
        throw new AppError(
          403,
          'Forbidden',
          `Agent '${agentId}' is ${agent.lifecycleState}`,
        );
      }

      // 4. Validate scope against permission boundaries
      const validation = await permissionService.validateScope(agentId, scope);

      // 5. If any scope denied, return 403
      if (!validation.valid) {
        await app.auditService.record({
          traceId: request.traceId,
          actorType: ActorTypes.AGENT,
          actorId: agentId,
          action: AuditActions.TOKEN_EXCHANGE_DENIED,
          resource: `token:${agentId}`,
          resourceType: ResourceTypes.TOKEN,
          outcome: Outcomes.DENIED,
          agentId,
          outcomeReason: 'Scope exceeds permission boundaries',
          metadata: { requestedScope: scope, denied: validation.denied },
        });

        throw new AppError(403, 'Forbidden', 'Requested scope exceeds permission boundaries', {
          denied: validation.denied,
        });
      }

      // 6. Issue downscoped token
      const result = await idp.issueDownscopedToken(
        parentClaims,
        scope,
        validation.granted,
        ttlMinutes,
      );

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.AGENT,
        actorId: agentId,
        action: AuditActions.TOKEN_EXCHANGED,
        resource: `token:${agentId}`,
        resourceType: ResourceTypes.TOKEN,
        outcome: Outcomes.SUCCESS,
        agentId,
        metadata: { scope, ttlMinutes, parentJti: parentClaims.jti },
      });

      return reply.send(result);
    },
  });
}
