import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export const traceIdPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('traceId', '');

  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-trace-id'];
    const traceId = typeof incoming === 'string' && incoming.length > 0
      ? incoming
      : randomUUID();
    request.traceId = traceId;
    void reply.header('x-trace-id', traceId);
  });
});
