import type { Database } from '../db/connection.js';
import type { AuditService } from '../services/audit.service.js';
import type { AgentTokenClaims } from '../services/identity-provider.js';
import type { IPolicyEngine } from '../services/policy-engine.js';
import type { RevocationSet } from '../services/revocation-set.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    auditService: AuditService;
    policyEngine: IPolicyEngine;
    revocationSet: RevocationSet;
  }

  interface FastifyRequest {
    traceId: string;
    agentClaims?: AgentTokenClaims;
  }
}
