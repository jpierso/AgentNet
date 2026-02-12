import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

export async function healthRoute(app: FastifyInstance) {
  app.get('/', async (_request, reply) => {
    try {
      await app.db.execute(sql`SELECT 1`);
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'agentnet-registry',
      });
    } catch {
      return reply.status(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        service: 'agentnet-registry',
        message: 'Database connection failed',
      });
    }
  });
}
