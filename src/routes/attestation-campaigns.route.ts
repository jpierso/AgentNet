import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AttestationService } from '../services/attestation.service.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import type { AttestationCampaign } from '../db/schema.js';
import type { CampaignResponse } from '../schemas/attestation.schema.js';
import {
  createCampaignSchema,
  campaignIdParamSchema,
  campaignQuerySchema,
  campaignResponseSchema,
  campaignListResponseSchema,
  campaignProgressSchema,
} from '../schemas/attestation.schema.js';
import { z } from 'zod';

function formatCampaign(c: AttestationCampaign): CampaignResponse {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    frequency: c.frequency as CampaignResponse['frequency'],
    scope: c.scope as CampaignResponse['scope'],
    scopeFilter: (c.scopeFilter as Record<string, unknown>) ?? null,
    status: c.status as CampaignResponse['status'],
    createdBy: c.createdBy,
    dueDate: c.dueDate.toISOString(),
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function attestationCampaignsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const attestationService = new AttestationService(app.db);

  // POST /attestation-campaigns — Create campaign + auto-generate items
  typedApp.route({
    method: 'POST',
    url: '/',
    schema: {
      body: createCampaignSchema,
      response: {
        201: z.object({
          campaign: campaignResponseSchema,
          itemsGenerated: z.number(),
        }),
      },
    },
    handler: async (request, reply) => {
      const { campaign, itemsGenerated } = await attestationService.createCampaign(request.body);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: request.body.createdBy,
        action: AuditActions.CAMPAIGN_CREATED,
        resource: `campaign:${campaign.id}`,
        resourceType: ResourceTypes.CAMPAIGN,
        outcome: Outcomes.SUCCESS,
        metadata: { itemsGenerated, scope: campaign.scope },
      });

      return reply.status(201).send({
        campaign: formatCampaign(campaign),
        itemsGenerated,
      });
    },
  });

  // GET /attestation-campaigns — List campaigns
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: campaignQuerySchema,
      response: { 200: campaignListResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await attestationService.listCampaigns(request.query);
      return reply.send({
        data: result.data.map(formatCampaign),
        total: result.total,
        limit: request.query.limit,
        offset: request.query.offset,
      });
    },
  });

  // GET /attestation-campaigns/:campaignId — Get campaign
  typedApp.route({
    method: 'GET',
    url: '/:campaignId',
    schema: {
      params: campaignIdParamSchema,
      response: { 200: campaignResponseSchema },
    },
    handler: async (request, reply) => {
      const campaign = await attestationService.getCampaign(request.params.campaignId);
      return reply.send(formatCampaign(campaign));
    },
  });

  // GET /attestation-campaigns/:campaignId/progress — Campaign progress
  typedApp.route({
    method: 'GET',
    url: '/:campaignId/progress',
    schema: {
      params: campaignIdParamSchema,
      response: { 200: campaignProgressSchema },
    },
    handler: async (request, reply) => {
      const progress = await attestationService.getCampaignProgress(request.params.campaignId);
      return reply.send(progress);
    },
  });

  // POST /attestation-campaigns/:campaignId/cancel — Cancel campaign
  typedApp.route({
    method: 'POST',
    url: '/:campaignId/cancel',
    schema: {
      params: campaignIdParamSchema,
      response: { 200: campaignResponseSchema },
    },
    handler: async (request, reply) => {
      const campaign = await attestationService.cancelCampaign(request.params.campaignId);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: campaign.createdBy,
        action: AuditActions.CAMPAIGN_CANCELLED,
        resource: `campaign:${campaign.id}`,
        resourceType: ResourceTypes.CAMPAIGN,
        outcome: Outcomes.SUCCESS,
      });

      return reply.send(formatCampaign(campaign));
    },
  });

  // POST /attestation-campaigns/:campaignId/process-expired
  typedApp.route({
    method: 'POST',
    url: '/:campaignId/process-expired',
    schema: {
      params: campaignIdParamSchema,
      response: { 200: z.object({ suspendedCount: z.number() }) },
    },
    handler: async (request, reply) => {
      const result = await attestationService.processExpiredCampaign(request.params.campaignId);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.SYSTEM,
        actorId: 'system',
        action: AuditActions.CAMPAIGN_COMPLETED,
        resource: `campaign:${request.params.campaignId}`,
        resourceType: ResourceTypes.CAMPAIGN,
        outcome: Outcomes.SUCCESS,
        metadata: { suspendedCount: result.suspendedCount },
      });

      return reply.send(result);
    },
  });
}
