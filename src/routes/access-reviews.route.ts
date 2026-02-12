import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AccessReviewService } from '../services/access-review.service.js';
import {
  accessReviewUserParamSchema,
  accessReviewResponseSchema,
} from '../schemas/access-review.schema.js';

export async function accessReviewsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const accessReviewService = new AccessReviewService(app.db);

  // GET /access-reviews/users/:userId
  typedApp.route({
    method: 'GET',
    url: '/users/:userId',
    schema: {
      params: accessReviewUserParamSchema,
      response: { 200: accessReviewResponseSchema },
    },
    handler: async (request, reply) => {
      const agents = await accessReviewService.getUserAccessSummary(request.params.userId);
      return reply.send({
        userId: request.params.userId,
        agents,
        reviewedAt: new Date().toISOString(),
      });
    },
  });
}
