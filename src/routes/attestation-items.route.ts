import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AttestationService } from '../services/attestation.service.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import type { AttestationItem } from '../db/schema.js';
import type { ItemResponse } from '../schemas/attestation.schema.js';
import {
  itemIdParamSchema,
  itemQuerySchema,
  reviewItemSchema,
  itemResponseSchema,
  itemListResponseSchema,
} from '../schemas/attestation.schema.js';

function formatItem(item: AttestationItem): ItemResponse {
  return {
    id: item.id,
    campaignId: item.campaignId,
    agentId: item.agentId,
    permissionId: item.permissionId,
    reviewerUserId: item.reviewerUserId,
    reviewerRole: item.reviewerRole as ItemResponse['reviewerRole'],
    permissionSnapshot: item.permissionSnapshot as Record<string, unknown>,
    status: item.status as ItemResponse['status'],
    decision: item.decision ?? null,
    decisionNote: item.decisionNote ?? null,
    decidedAt: item.decidedAt ? item.decidedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export { formatItem };

export async function attestationItemsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const attestationService = new AttestationService(app.db);

  // GET /attestation-items — List items
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: itemQuerySchema,
      response: { 200: itemListResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await attestationService.listItems(request.query);
      return reply.send({
        data: result.data.map(formatItem),
        total: result.total,
        limit: request.query.limit,
        offset: request.query.offset,
      });
    },
  });

  // GET /attestation-items/:itemId — Get item
  typedApp.route({
    method: 'GET',
    url: '/:itemId',
    schema: {
      params: itemIdParamSchema,
      response: { 200: itemResponseSchema },
    },
    handler: async (request, reply) => {
      const item = await attestationService.getItem(request.params.itemId);
      return reply.send(formatItem(item));
    },
  });

  // POST /attestation-items/:itemId/review — Review item
  typedApp.route({
    method: 'POST',
    url: '/:itemId/review',
    schema: {
      params: itemIdParamSchema,
      body: reviewItemSchema,
      response: { 200: itemResponseSchema },
    },
    handler: async (request, reply) => {
      const item = await attestationService.reviewItem(
        request.params.itemId,
        request.body,
      );

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: request.body.reviewerUserId,
        action: AuditActions.ATTESTATION_REVIEWED,
        resource: `attestation-item:${item.id}`,
        resourceType: ResourceTypes.ATTESTATION,
        outcome: Outcomes.SUCCESS,
        agentId: item.agentId,
        metadata: { decision: request.body.decision, campaignId: item.campaignId },
      });

      return reply.send(formatItem(item));
    },
  });
}
