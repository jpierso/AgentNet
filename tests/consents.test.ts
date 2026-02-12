import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission, createTestConsent } from './helpers.js';

describe('Consent Grants', () => {
  let app: FastifyInstance;

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

  describe('POST /consents', () => {
    it('should grant consent and snapshot permissions', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read', 'list'] });
      await seedPermission(agent.agentId, { resource: 'billing', allowedActions: ['read'], actionTier: 'tier_1' });

      const input = createTestConsent(agent.agentId);
      const res = await app.inject({ method: 'POST', url: '/consents', payload: input });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.agentId).toBe(agent.agentId);
      expect(body.userId).toBe(input.userId);
      expect(body.scopes).toEqual(input.scopes);
      expect(body.status).toBe('active');
      expect(body.permissionSnapshot).toHaveLength(2);
      expect(body.revokedAt).toBeNull();
      expect(body.id).toBeDefined();
    });

    it('should return 404 for non-existent agent', async () => {
      const input = createTestConsent('non-existent-agent');
      const res = await app.inject({ method: 'POST', url: '/consents', payload: input });

      expect(res.statusCode).toBe(404);
    });

    it('should snapshot empty permissions if agent has none', async () => {
      const agent = await seedAgent();
      const input = createTestConsent(agent.agentId);
      const res = await app.inject({ method: 'POST', url: '/consents', payload: input });

      expect(res.statusCode).toBe(201);
      expect(res.json().permissionSnapshot).toHaveLength(0);
    });

    it('should return 422 for missing required fields', async () => {
      const res = await app.inject({ method: 'POST', url: '/consents', payload: {} });
      expect(res.statusCode).toBe(422);
    });

    it('should return 422 for empty scopes array', async () => {
      const agent = await seedAgent();
      const res = await app.inject({
        method: 'POST',
        url: '/consents',
        payload: { agentId: agent.agentId, userId: '550e8400-e29b-41d4-a716-446655440000', scopes: [] },
      });
      expect(res.statusCode).toBe(422);
    });

    it('should allow multiple consents for same agent/user', async () => {
      const agent = await seedAgent();
      const input = createTestConsent(agent.agentId);

      const res1 = await app.inject({ method: 'POST', url: '/consents', payload: input });
      const res2 = await app.inject({ method: 'POST', url: '/consents', payload: input });

      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);
      expect(res1.json().id).not.toBe(res2.json().id);
    });
  });

  describe('GET /consents/:consentId', () => {
    it('should return a consent by ID', async () => {
      const agent = await seedAgent();
      const created = await app.inject({
        method: 'POST',
        url: '/consents',
        payload: createTestConsent(agent.agentId),
      });
      const consentId = created.json().id;

      const res = await app.inject({ method: 'GET', url: `/consents/${consentId}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(consentId);
    });

    it('should return 404 for non-existent consent', async () => {
      const res = await app.inject({ method: 'GET', url: '/consents/00000000-0000-0000-0000-000000000000' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /consents', () => {
    it('should list all consents', async () => {
      const agent = await seedAgent();
      await app.inject({ method: 'POST', url: '/consents', payload: createTestConsent(agent.agentId) });
      await app.inject({ method: 'POST', url: '/consents', payload: createTestConsent(agent.agentId) });

      const res = await app.inject({ method: 'GET', url: '/consents' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('should filter by userId', async () => {
      const agent = await seedAgent();
      const userId1 = '550e8400-e29b-41d4-a716-446655440000';
      const userId2 = '550e8400-e29b-41d4-a716-446655440099';
      await app.inject({ method: 'POST', url: '/consents', payload: createTestConsent(agent.agentId, { userId: userId1 }) });
      await app.inject({ method: 'POST', url: '/consents', payload: createTestConsent(agent.agentId, { userId: userId2 }) });

      const res = await app.inject({ method: 'GET', url: `/consents?userId=${userId1}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].userId).toBe(userId1);
    });

    it('should filter by agentId', async () => {
      const agent1 = await seedAgent();
      const agent2 = await seedAgent();
      await app.inject({ method: 'POST', url: '/consents', payload: createTestConsent(agent1.agentId) });
      await app.inject({ method: 'POST', url: '/consents', payload: createTestConsent(agent2.agentId) });

      const res = await app.inject({ method: 'GET', url: `/consents?agentId=${agent1.agentId}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    });

    it('should filter by status', async () => {
      const agent = await seedAgent();
      const created = await app.inject({
        method: 'POST',
        url: '/consents',
        payload: createTestConsent(agent.agentId),
      });
      await app.inject({ method: 'DELETE', url: `/consents/${created.json().id}` });

      // Create another active consent
      await app.inject({ method: 'POST', url: '/consents', payload: createTestConsent(agent.agentId) });

      const activeRes = await app.inject({ method: 'GET', url: '/consents?status=active' });
      expect(activeRes.json().data).toHaveLength(1);

      const revokedRes = await app.inject({ method: 'GET', url: '/consents?status=revoked' });
      expect(revokedRes.json().data).toHaveLength(1);
    });
  });

  describe('DELETE /consents/:consentId', () => {
    it('should revoke a consent', async () => {
      const agent = await seedAgent();
      const created = await app.inject({
        method: 'POST',
        url: '/consents',
        payload: createTestConsent(agent.agentId),
      });
      const consentId = created.json().id;

      const res = await app.inject({ method: 'DELETE', url: `/consents/${consentId}` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('revoked');
      expect(body.revokedAt).toBeTruthy();
    });

    it('should return 409 for already revoked consent', async () => {
      const agent = await seedAgent();
      const created = await app.inject({
        method: 'POST',
        url: '/consents',
        payload: createTestConsent(agent.agentId),
      });
      const consentId = created.json().id;

      await app.inject({ method: 'DELETE', url: `/consents/${consentId}` });
      const res = await app.inject({ method: 'DELETE', url: `/consents/${consentId}` });

      expect(res.statusCode).toBe(409);
    });

    it('should return 404 for non-existent consent', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/consents/00000000-0000-0000-0000-000000000000' });
      expect(res.statusCode).toBe(404);
    });
  });
});
