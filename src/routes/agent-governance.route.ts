import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConsentService } from '../services/consent.service.js';
import { AttestationService } from '../services/attestation.service.js';
import { DriftDetectionService } from '../services/drift-detection.service.js';
import { consentListResponseSchema } from '../schemas/consent.schema.js';
import { itemListResponseSchema } from '../schemas/attestation.schema.js';
import { agentDriftResponseSchema } from '../schemas/drift-detection.schema.js';
import type { ConsentGrant, AttestationItem } from '../db/schema.js';
import type { ConsentResponse } from '../schemas/consent.schema.js';
import type { ItemResponse } from '../schemas/attestation.schema.js';

const agentIdParamSchema = z.object({ agentId: z.string().min(1) });

function formatConsent(c: ConsentGrant): ConsentResponse {
  return {
    id: c.id,
    agentId: c.agentId,
    userId: c.userId,
    permissionSnapshot: c.permissionSnapshot as Record<string, unknown>[],
    scopes: c.scopes as string[],
    status: c.status as ConsentResponse['status'],
    revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
    revokedBy: c.revokedBy ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

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

export async function agentGovernanceRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const consentService = new ConsentService(app.db);
  const attestationService = new AttestationService(app.db);
  const driftService = new DriftDetectionService(app.db);

  // GET /agents/:agentId/consents
  typedApp.route({
    method: 'GET',
    url: '/:agentId/consents',
    schema: {
      params: agentIdParamSchema,
      response: { 200: consentListResponseSchema },
    },
    handler: async (request, reply) => {
      const data = await consentService.getByAgentId(request.params.agentId);
      return reply.send({
        data: data.map(formatConsent),
        total: data.length,
        limit: data.length,
        offset: 0,
      });
    },
  });

  // GET /agents/:agentId/attestation-items
  typedApp.route({
    method: 'GET',
    url: '/:agentId/attestation-items',
    schema: {
      params: agentIdParamSchema,
      response: { 200: itemListResponseSchema },
    },
    handler: async (request, reply) => {
      const data = await attestationService.getItemsByAgentId(request.params.agentId);
      return reply.send({
        data: data.map(formatItem),
        total: data.length,
        limit: data.length,
        offset: 0,
      });
    },
  });

  // GET /agents/:agentId/drift
  typedApp.route({
    method: 'GET',
    url: '/:agentId/drift',
    schema: {
      params: agentIdParamSchema,
      response: { 200: agentDriftResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await driftService.detectDrift(request.params.agentId);
      return reply.send(result);
    },
  });
}
