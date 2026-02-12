import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DriftDetectionService } from '../services/drift-detection.service.js';
import {
  driftAgentParamSchema,
  driftQuerySchema,
  agentDriftResponseSchema,
  batchDriftResponseSchema,
} from '../schemas/drift-detection.schema.js';

export async function driftDetectionRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const driftService = new DriftDetectionService(app.db);

  // GET /drift-detection/agents/:agentId — Detect drift for one agent
  typedApp.route({
    method: 'GET',
    url: '/agents/:agentId',
    schema: {
      params: driftAgentParamSchema,
      response: { 200: agentDriftResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await driftService.detectDrift(request.params.agentId);
      return reply.send(result);
    },
  });

  // GET /drift-detection — Batch drift summary
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: driftQuerySchema,
      response: { 200: batchDriftResponseSchema },
    },
    handler: async (request, reply) => {
      const agents = await driftService.detectDriftBatch(request.query.ownerUserId);
      return reply.send({
        agents,
        detectedAt: new Date().toISOString(),
      });
    },
  });
}
