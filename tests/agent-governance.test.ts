import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission, createTestConsent, createTestCampaign } from './helpers.js';

describe('Agent-Scoped Governance Routes', () => {
  let app: FastifyInstance;
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  async function seedAgent(overrides = {}) {
    const input = createTestAgent(overrides);
    const res = await app.inject({ method: 'POST', url: '/agents', payload: input });
    return res.json();
  }

  async function seedPermission(agentId: string, overrides = {}) {
    const input = createTestPermission(agentId, overrides);
    const res = await app.inject({ method: 'POST', url: '/permissions', payload: input });
    return res.json();
  }

  describe('GET /agents/:agentId/consents', () => {
    it('should return consents for an agent', async () => {
      const agent = await seedAgent();
      await app.inject({
        method: 'POST',
        url: '/consents',
        payload: createTestConsent(agent.agentId),
      });

      const res = await app.inject({ method: 'GET', url: `/agents/${agent.agentId}/consents` });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().total).toBe(1);
    });

    it('should return empty for agent with no consents', async () => {
      const agent = await seedAgent();

      const res = await app.inject({ method: 'GET', url: `/agents/${agent.agentId}/consents` });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(0);
    });
  });

  describe('GET /agents/:agentId/attestation-items', () => {
    it('should return attestation items for an agent', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });

      const campaignInput = createTestCampaign();
      await app.inject({ method: 'POST', url: '/attestation-campaigns', payload: campaignInput });

      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.agentId}/attestation-items`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].agentId).toBe(agent.agentId);
    });

    it('should return empty for agent with no attestation items', async () => {
      const agent = await seedAgent();

      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.agentId}/attestation-items`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(0);
    });
  });

  describe('GET /agents/:agentId/drift', () => {
    it('should return drift report for an agent', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });

      const res = await app.inject({ method: 'GET', url: `/agents/${agent.agentId}/drift` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.agentId).toBe(agent.agentId);
      expect(body.detectedAt).toBeDefined();
    });
  });
});
