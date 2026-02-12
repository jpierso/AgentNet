import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createDb } from '../db/connection.js';
import { env } from '../config/env.js';

interface DbPluginOptions {
  databaseUrl?: string;
}

export const dbPlugin = fp(async (app: FastifyInstance, opts: DbPluginOptions) => {
  const url = opts.databaseUrl ?? env.DATABASE_URL;
  const { db, queryClient } = createDb(url);

  app.decorate('db', db);

  app.addHook('onClose', async () => {
    await queryClient.end();
  });
});
