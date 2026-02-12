import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ConsentService } from '../services/consent.service.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import type { ConsentGrant } from '../db/schema.js';
import type { ConsentResponse } from '../schemas/consent.schema.js';
import {
  createConsentSchema,
  consentIdParamSchema,
  consentQuerySchema,
  consentResponseSchema,
  consentListResponseSchema,
} from '../schemas/consent.schema.js';

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

export async function consentsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const consentService = new ConsentService(app.db);

  // POST /consents — Grant consent
  typedApp.route({
    method: 'POST',
    url: '/',
    schema: {
      body: createConsentSchema,
      response: { 201: consentResponseSchema },
    },
    handler: async (request, reply) => {
      const consent = await consentService.grant(request.body);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: request.body.userId,
        action: AuditActions.CONSENT_GRANTED,
        resource: `consent:${consent.id}`,
        resourceType: ResourceTypes.CONSENT,
        outcome: Outcomes.SUCCESS,
        agentId: consent.agentId,
        metadata: { scopes: request.body.scopes },
      });

      return reply.status(201).send(formatConsent(consent));
    },
  });

  // GET /consents — List consents
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: consentQuerySchema,
      response: { 200: consentListResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await consentService.list(request.query);
      return reply.send({
        data: result.data.map(formatConsent),
        total: result.total,
        limit: request.query.limit,
        offset: request.query.offset,
      });
    },
  });

  // GET /consents/:consentId — Get consent by ID
  typedApp.route({
    method: 'GET',
    url: '/:consentId',
    schema: {
      params: consentIdParamSchema,
      response: { 200: consentResponseSchema },
    },
    handler: async (request, reply) => {
      const consent = await consentService.getById(request.params.consentId);
      return reply.send(formatConsent(consent));
    },
  });

  // DELETE /consents/:consentId — Revoke consent
  typedApp.route({
    method: 'DELETE',
    url: '/:consentId',
    schema: {
      params: consentIdParamSchema,
      response: { 200: consentResponseSchema },
    },
    handler: async (request, reply) => {
      // Use userId from query or default — in a real system this comes from auth
      const revokedBy = (request.query as Record<string, string>).userId ?? 'system';
      const consent = await consentService.revoke(request.params.consentId, revokedBy);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: revokedBy,
        action: AuditActions.CONSENT_REVOKED,
        resource: `consent:${consent.id}`,
        resourceType: ResourceTypes.CONSENT,
        outcome: Outcomes.SUCCESS,
        agentId: consent.agentId,
      });

      return reply.send(formatConsent(consent));
    },
  });
}
