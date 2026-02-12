import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import jwt from 'jsonwebtoken';
import { AgentService } from '../services/agent.service.js';
import { TokenRevocationService } from '../services/token-revocation.service.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import { env } from '../config/env.js';
import {
  revokeTokenBodySchema,
  revokeTokenResponseSchema,
  introspectTokenBodySchema,
  introspectTokenResponseSchema,
} from '../schemas/token-revocation.schema.js';
import type { AgentTokenClaims, DownscopedTokenClaims } from '../services/identity-provider.js';

export async function tokenRevocationRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const agentService = new AgentService(app.db);
  const tokenRevocationService = new TokenRevocationService(app.db, app.revocationSet);

  // POST /tokens/revoke
  typedApp.route({
    method: 'POST',
    url: '/revoke',
    schema: {
      body: revokeTokenBodySchema,
      response: { 200: revokeTokenResponseSchema },
    },
    handler: async (request, reply) => {
      const { jti, agentId, revokedBy, reason } = request.body as {
        jti?: string;
        agentId?: string;
        revokedBy: string;
        reason: string;
      };

      if (jti) {
        // Single token revocation — we need agentId from token or request
        const effectiveAgentId = agentId ?? 'unknown';

        await tokenRevocationService.revokeByJti({
          jti,
          agentId: effectiveAgentId,
          revokedBy,
          reason,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h default
        });

        await app.auditService.record({
          traceId: request.traceId,
          actorType: ActorTypes.USER,
          actorId: revokedBy,
          action: AuditActions.TOKEN_REVOKED,
          resource: `token:${jti}`,
          resourceType: ResourceTypes.TOKEN,
          outcome: Outcomes.SUCCESS,
          metadata: { jti, agentId: effectiveAgentId, reason },
        });

        return reply.send({ revoked: true, jti, type: 'single' as const });
      }

      // Blanket agent revocation
      await tokenRevocationService.revokeByAgent({
        agentId: agentId!,
        revokedBy,
        reason,
      });

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: revokedBy,
        action: AuditActions.TOKEN_BLANKET_REVOKED,
        resource: `agent:${agentId}`,
        resourceType: ResourceTypes.TOKEN,
        outcome: Outcomes.SUCCESS,
        metadata: { agentId, reason },
      });

      return reply.send({ revoked: true, agentId, type: 'blanket' as const });
    },
  });

  // POST /tokens/introspect
  typedApp.route({
    method: 'POST',
    url: '/introspect',
    schema: {
      body: introspectTokenBodySchema,
      response: { 200: introspectTokenResponseSchema },
    },
    handler: async (request, reply) => {
      const { token } = request.body;

      // Decode without verification first to get claims
      let claims: AgentTokenClaims;
      try {
        claims = jwt.verify(token, env.JWT_SECRET, {
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
        }) as AgentTokenClaims;
      } catch {
        return reply.send({ active: false });
      }

      // Check expiry (jwt.verify already does this, but be explicit)
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp <= now) {
        return reply.send({ active: false });
      }

      // Check revocation
      const parentJti = (claims as unknown as DownscopedTokenClaims).parent_token_jti;
      const isRevoked = app.revocationSet.isRevoked(
        claims.jti,
        claims.agent_id,
        claims.iat,
        parentJti,
      );

      if (isRevoked) {
        return reply.send({
          active: false,
          agentId: claims.agent_id,
          revoked: true,
        });
      }

      // Check agent state
      try {
        const agent = await agentService.getByAgentId(claims.agent_id);
        if (agent.lifecycleState !== 'active') {
          return reply.send({
            active: false,
            agentId: claims.agent_id,
            agentState: agent.lifecycleState,
          });
        }
      } catch {
        return reply.send({
          active: false,
          agentId: claims.agent_id,
        });
      }

      const downscopedClaims = claims as unknown as DownscopedTokenClaims;

      return reply.send({
        active: true,
        agentId: claims.agent_id,
        ownerUserId: claims.owner_user_id,
        managerUserId: claims.manager_user_id,
        agentType: claims.agent_type,
        scope: downscopedClaims.scope,
        tokenType: downscopedClaims.token_type ?? 'standard',
        issuedAt: new Date(claims.iat * 1000).toISOString(),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      });
    },
  });
}
