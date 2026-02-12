import type { Database } from '../db/connection.js';
import type { AuditService } from '../services/audit.service.js';
import type { AgentTokenClaims } from '../services/identity-provider.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    auditService: AuditService;
  }

  interface FastifyRequest {
    traceId: string;
    agentClaims?: AgentTokenClaims;
  }
}
