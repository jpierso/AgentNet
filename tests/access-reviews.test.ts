import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission, createTestConsent } from './helpers.js';

describe('Access Reviews', () => {
  let app: FastifyInstance;
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';
  const managerId = '550e8400-e29b-41d4-a716-446655440001';

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

  describe('GET /access-reviews/users/:userId', () => {
    it('should return an access summary for a user with agents', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });

      const res = await app.inject({ method: 'GET', url: `/access-reviews/users/${ownerId}` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.userId).toBe(ownerId);
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0].agentId).toBe(agent.agentId);
      expect(body.agents[0].permissions).toHaveLength(1);
      expect(body.agents[0].permissions[0].resource).toBe('documents');
      expect(body.reviewedAt).toBeDefined();
    });

    it('should return empty agents for user with no agents', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/access-reviews/users/550e8400-e29b-41d4-a716-446655440099',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(0);
    });

    it('should include agents where user is manager', async () => {
      await seedAgent();

      const res = await app.inject({ method: 'GET', url: `/access-reviews/users/${managerId}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(1);
    });

    it('should include consent information', async () => {
      const agent = await seedAgent();
      await app.inject({
        method: 'POST',
        url: '/consents',
        payload: createTestConsent(agent.agentId, { userId: ownerId }),
      });

      const res = await app.inject({ method: 'GET', url: `/access-reviews/users/${ownerId}` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.agents[0].consents).toHaveLength(1);
      expect(body.agents[0].consents[0].status).toBe('active');
    });

    it('should show multiple agents for a user', async () => {
      await seedAgent();
      await seedAgent();

      const res = await app.inject({ method: 'GET', url: `/access-reviews/users/${ownerId}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(2);
    });

    it('should show permissions with lastUsed as null when no audit events for resource', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });

      const res = await app.inject({ method: 'GET', url: `/access-reviews/users/${ownerId}` });

      expect(res.statusCode).toBe(200);
      const perm = res.json().agents[0].permissions[0];
      expect(perm.lastUsed).toBeNull();
    });

    it('should show agent lifecycle state', async () => {
      const agent = await seedAgent();
      // Revoke the agent
      await app.inject({ method: 'DELETE', url: `/agents/${agent.agentId}` });

      const res = await app.inject({ method: 'GET', url: `/access-reviews/users/${ownerId}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents[0].lifecycleState).toBe('revoked');
    });

    it('should return 422 for invalid userId format', async () => {
      const res = await app.inject({ method: 'GET', url: '/access-reviews/users/not-a-uuid' });
      expect(res.statusCode).toBe(422);
    });

    it('should show multiple permissions per agent', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });
      await seedPermission(agent.agentId, { resource: 'billing', allowedActions: ['read'], actionTier: 'tier_1' });

      const res = await app.inject({ method: 'GET', url: `/access-reviews/users/${ownerId}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents[0].permissions).toHaveLength(2);
    });
  });
});
