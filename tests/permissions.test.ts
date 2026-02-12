import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission } from './helpers.js';

describe('Permission Boundaries CRUD', () => {
  let app: FastifyInstance;
  let testAgentId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    // Create a test agent for permission tests
    const agent = createTestAgent();
    testAgentId = agent.agentId;
    await app.inject({ method: 'POST', url: '/agents', payload: agent });
  });

  describe('POST /permissions', () => {
    it('should create a permission boundary and return 201', async () => {
      const input = createTestPermission(testAgentId);
      const response = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.agentId).toBe(testAgentId);
      expect(body.resource).toBe('documents');
      expect(body.allowedActions).toEqual(['read', 'list']);
      expect(body.actionTier).toBe('tier_0');
      expect(body.id).toBeDefined();
    });

    it('should return 404 for non-existent agent', async () => {
      const input = createTestPermission('nonexistent-agent');
      const response = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: input,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject invalid action tier', async () => {
      const input = createTestPermission(testAgentId, { actionTier: 'tier_99' });
      const response = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: input,
      });

      expect(response.statusCode).toBe(422);
    });

    it('should create permissions with different tiers for same resource', async () => {
      const input1 = createTestPermission(testAgentId, { actionTier: 'tier_0' });
      const input2 = createTestPermission(testAgentId, {
        actionTier: 'tier_1',
        allowedActions: ['create', 'update'],
      });

      const res1 = await app.inject({ method: 'POST', url: '/permissions', payload: input1 });
      const res2 = await app.inject({ method: 'POST', url: '/permissions', payload: input2 });

      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);
    });

    it('should create permissions with expiration', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const input = createTestPermission(testAgentId, { expiresAt: futureDate });
      const response = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().expiresAt).toBeDefined();
    });

    it('should create permissions with conditions', async () => {
      const input = createTestPermission(testAgentId, {
        conditions: { department: 'engineering' },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().conditions).toEqual({ department: 'engineering' });
    });
  });

  describe('GET /permissions/:permissionId', () => {
    it('should return a permission by ID', async () => {
      const input = createTestPermission(testAgentId);
      const createRes = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: input,
      });
      const permissionId = createRes.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/permissions/${permissionId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(permissionId);
      expect(response.json().agentId).toBe(testAgentId);
    });

    it('should return 404 for non-existent permission', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/permissions/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /permissions (list)', () => {
    it('should list permissions with agentId filter', async () => {
      const input = createTestPermission(testAgentId);
      await app.inject({ method: 'POST', url: '/permissions', payload: input });

      const response = await app.inject({
        method: 'GET',
        url: `/permissions?agentId=${testAgentId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it('should filter by action tier', async () => {
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId, { actionTier: 'tier_0' }),
      });
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId, {
          resource: 'billing',
          actionTier: 'tier_1',
          allowedActions: ['create'],
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/permissions?actionTier=tier_0',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].actionTier).toBe('tier_0');
    });
  });

  describe('GET /agents/:agentId/permissions', () => {
    it('should return all permissions for an agent', async () => {
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId),
      });
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId, {
          resource: 'billing',
          actionTier: 'tier_1',
          allowedActions: ['create'],
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/agents/${testAgentId}/permissions`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(2);
      expect(response.json().total).toBe(2);
    });

    it('should return empty array for agent with no permissions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/${testAgentId}/permissions`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(0);
    });
  });

  describe('PATCH /permissions/:permissionId', () => {
    it('should update allowed actions', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId),
      });
      const permissionId = createRes.json().id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/permissions/${permissionId}`,
        payload: { allowedActions: ['read'] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().allowedActions).toEqual(['read']);
    });

    it('should prevent tier escalation', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId, { actionTier: 'tier_0' }),
      });
      const permissionId = createRes.json().id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/permissions/${permissionId}`,
        payload: { actionTier: 'tier_2' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().message).toContain('Cannot escalate tier');
    });

    it('should allow tier de-escalation', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId, {
          actionTier: 'tier_2',
          resource: 'admin-resource',
          allowedActions: ['manage'],
        }),
      });
      const permissionId = createRes.json().id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/permissions/${permissionId}`,
        payload: { actionTier: 'tier_1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().actionTier).toBe('tier_1');
    });
  });

  describe('DELETE /permissions/:permissionId', () => {
    it('should delete a permission and return the deleted record', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(testAgentId),
      });
      const permissionId = createRes.json().id;

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/permissions/${permissionId}`,
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().id).toBe(permissionId);

      // Verify it's gone
      const getRes = await app.inject({
        method: 'GET',
        url: `/permissions/${permissionId}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('should return 404 for already-deleted permission', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/permissions/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
