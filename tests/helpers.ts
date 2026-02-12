import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { agentIdentities, permissionBoundaries, auditEvents, policyRules, approvalRequests, consentGrants, attestationItems, attestationCampaigns } from '../src/db/schema.js';

const TEST_DB_URL = 'postgresql://agentnet_test:agentnet_test@localhost:5433/agentnet_test';

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ database_url: TEST_DB_URL });
  await app.ready();
  return app;
}

export async function cleanDatabase(app: FastifyInstance) {
  // Order matters: delete children before parents
  await app.db.delete(attestationItems);
  await app.db.delete(attestationCampaigns);
  await app.db.delete(consentGrants);
  await app.db.delete(auditEvents);
  await app.db.delete(approvalRequests);
  await app.db.delete(policyRules);
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

export function createTestConsent(agentId: string, overrides: Record<string, unknown> = {}) {
  return {
    agentId,
    userId: '550e8400-e29b-41d4-a716-446655440000',
    scopes: ['documents:read', 'documents:list'],
    ...overrides,
  };
}

export function createTestCampaign(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Q1 2026 Access Review',
    description: 'Quarterly recertification',
    frequency: 'quarterly' as const,
    scope: 'all_agents' as const,
    createdBy: '550e8400-e29b-41d4-a716-446655440000',
    dueDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}
