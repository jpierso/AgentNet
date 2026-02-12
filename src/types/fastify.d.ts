import type { Database } from '../db/connection.js';
import type { AuditService } from '../services/audit.service.js';
import type { AgentTokenClaims } from '../services/identity-provider.js';
import type { IPolicyEngine } from '../services/policy-engine.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    auditService: AuditService;
    policyEngine: IPolicyEngine;
  }

  interface FastifyRequest {
    traceId: string;
    agentClaims?: AgentTokenClaims;
  }
}
