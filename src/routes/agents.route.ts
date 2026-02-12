import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentService } from '../services/agent.service.js';
import { StubIdentityProvider } from '../services/stub-identity-provider.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import {
  createAgentSchema,
  updateAgentSchema,
  agentIdParamSchema,
  agentQuerySchema,
  agentResponseSchema,
  agentListResponseSchema,
} from '../schemas/agent.schema.js';
import type { AgentIdentity } from '../db/schema.js';
import type { AgentResponse } from '../schemas/agent.schema.js';

function formatAgent(agent: AgentIdentity): AgentResponse {
  return {
    ...agent,
    lifecycleState: agent.lifecycleState as AgentResponse['lifecycleState'],
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export async function agentsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const agentService = new AgentService(app.db);
  const idp = new StubIdentityProvider();

  // POST /agents — Create agent
  typedApp.route({
    method: 'POST',
    url: '/',
    schema: {
      body: createAgentSchema,
      response: { 201: agentResponseSchema },
    },
    handler: async (request, reply) => {
      const input = request.body;

      const [ownerValid, managerValid] = await Promise.all([
        idp.validateUser(input.ownerUserId),
        idp.validateUser(input.managerUserId),
      ]);

      if (!ownerValid) {
        throw new AppError(422, 'Validation Error', `owner_user_id '${input.ownerUserId}' is not a valid user`);
      }
      if (!managerValid) {
        throw new AppError(422, 'Validation Error', `manager_user_id '${input.managerUserId}' is not a valid user`);
      }

      const agent = await agentService.create(input);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: input.ownerUserId,
        action: AuditActions.AGENT_CREATED,
        resource: `agent:${agent.agentId}`,
        resourceType: ResourceTypes.AGENT,
        outcome: Outcomes.SUCCESS,
        agentId: agent.agentId,
        metadata: { agentType: agent.agentType },
      });

      return reply.status(201).send(formatAgent(agent));
    },
  });

  // GET /agents/:agentId — Get agent by agentId
  typedApp.route({
    method: 'GET',
    url: '/:agentId',
    schema: {
      params: agentIdParamSchema,
      response: { 200: agentResponseSchema },
    },
    handler: async (request, reply) => {
      const agent = await agentService.getByAgentId(request.params.agentId);
      return reply.send(formatAgent(agent));
    },
  });

  // PATCH /agents/:agentId — Update agent
  typedApp.route({
    method: 'PATCH',
    url: '/:agentId',
    schema: {
      params: agentIdParamSchema,
      body: updateAgentSchema,
      response: { 200: agentResponseSchema },
    },
    handler: async (request, reply) => {
      const updated = await agentService.update(request.params.agentId, request.body);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: updated.ownerUserId,
        action: AuditActions.AGENT_UPDATED,
        resource: `agent:${updated.agentId}`,
        resourceType: ResourceTypes.AGENT,
        outcome: Outcomes.SUCCESS,
        agentId: updated.agentId,
        metadata: { changes: request.body },
      });

      return reply.send(formatAgent(updated));
    },
  });

  // DELETE /agents/:agentId — Soft delete (revoke)
  typedApp.route({
    method: 'DELETE',
    url: '/:agentId',
    schema: {
      params: agentIdParamSchema,
      response: { 200: agentResponseSchema },
    },
    handler: async (request, reply) => {
      const revoked = await agentService.softDelete(request.params.agentId);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: revoked.ownerUserId,
        action: AuditActions.AGENT_REVOKED,
        resource: `agent:${revoked.agentId}`,
        resourceType: ResourceTypes.AGENT,
        outcome: Outcomes.SUCCESS,
        agentId: revoked.agentId,
      });

      return reply.send(formatAgent(revoked));
    },
  });

  // GET /agents — List agents with filters
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: agentQuerySchema,
      response: { 200: agentListResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await agentService.list(request.query);
      return reply.send({
        data: result.data.map(formatAgent),
        total: result.total,
        limit: request.query.limit,
        offset: request.query.offset,
      });
    },
  });
}
