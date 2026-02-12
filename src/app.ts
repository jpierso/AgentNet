import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { dbPlugin } from './plugins/db.plugin.js';
import { errorHandlerPlugin } from './plugins/error-handler.plugin.js';
import { traceIdPlugin } from './plugins/trace-id.plugin.js';
import { auditHookPlugin } from './plugins/audit-hook.plugin.js';
import { healthRoute } from './routes/health.route.js';
import { agentsRoute } from './routes/agents.route.js';
import { tokenRoute } from './routes/token.route.js';
import { permissionsRoute, agentPermissionsRoute } from './routes/permissions.route.js';
import { tokenExchangeRoute } from './routes/token-exchange.route.js';
import { auditRoute } from './routes/audit.route.js';
import { PgAuditStore } from './services/pg-audit-store.js';
import { AuditService } from './services/audit.service.js';
import { PgPolicyEngine } from './services/pg-policy-engine.js';
import { policiesRoute } from './routes/policies.route.js';
import { approvalsRoute } from './routes/approvals.route.js';

export interface BuildAppOptions {
  database_url?: string;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : {}),
    },
  });

  // Zod type provider
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Plugins (order matters: trace-id → error handler → db → audit)
  await app.register(traceIdPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(dbPlugin, { databaseUrl: opts.database_url });

  // Audit infrastructure — depends on db being available
  const auditStore = new PgAuditStore(app.db);
  const auditService = new AuditService(auditStore);
  app.decorate('auditService', auditService);

  // Policy engine
  const policyEngine = new PgPolicyEngine(app.db);
  app.decorate('policyEngine', policyEngine);

  // HTTP audit capture hook
  await app.register(auditHookPlugin);

  // Routes
  await app.register(healthRoute, { prefix: '/health' });
  await app.register(agentsRoute, { prefix: '/agents' });
  await app.register(tokenRoute, { prefix: '/agents' });
  await app.register(agentPermissionsRoute, { prefix: '/agents' });
  await app.register(tokenExchangeRoute, { prefix: '/agents' });
  await app.register(permissionsRoute, { prefix: '/permissions' });
  await app.register(auditRoute, { prefix: '/audit-events' });
  await app.register(policiesRoute, { prefix: '/policies' });
  await app.register(approvalsRoute, { prefix: '/approvals' });

  return app;
}
