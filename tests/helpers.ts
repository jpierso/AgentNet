import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { agentIdentities, permissionBoundaries, auditEvents } from '../src/db/schema.js';

const TEST_DB_URL = 'postgresql://agentnet_test:agentnet_test@localhost:5433/agentnet_test';

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ database_url: TEST_DB_URL });
  await app.ready();
  return app;
}

export async function cleanDatabase(app: FastifyInstance) {
  // Order matters: delete children before parents
  await app.db.delete(auditEvents);
  await app.db.delete(permissionBoundaries);
  await app.db.delete(agentIdentities);
}

export function createTestAgent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: `test-agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerUserId: '550e8400-e29b-41d4-a716-446655440000',
    managerUserId: '550e8400-e29b-41d4-a716-446655440001',
    agentType: 'code-assistant',
    modelVersion: 'gpt-4',
    purpose: 'Test agent for unit tests',
    ...overrides,
  };
}

export function createTestPermission(agentId: string, overrides: Record<string, unknown> = {}) {
  return {
    agentId,
    resource: 'documents',
    allowedActions: ['read', 'list'],
    actionTier: 'tier_0' as const,
    grantedBy: '550e8400-e29b-41d4-a716-446655440000',
    ...overrides,
  };
}
