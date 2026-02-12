import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';

describe('Agent Registry CRUD', () => {
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

  describe('POST /agents', () => {
    it('should create an agent and return 201', async () => {
      const input = createTestAgent();
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.agentId).toBe(input.agentId);
      expect(body.ownerUserId).toBe(input.ownerUserId);
      expect(body.managerUserId).toBe(input.managerUserId);
      expect(body.lifecycleState).toBe('active');
      expect(body.id).toBeDefined();
      expect(body.createdAt).toBeDefined();
    });

    it('should return 409 for duplicate agent_id', async () => {
      const input = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: input });
      const response = await app.inject({ method: 'POST', url: '/agents', payload: input });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('Conflict');
    });

    it('should return 422 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { agentId: 'test' },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should return 422 for invalid owner_user_id format', async () => {
      const input = createTestAgent({ ownerUserId: 'not-a-uuid' });
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: input,
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('GET /agents/:agentId', () => {
    it('should return an agent by agentId', async () => {
      const input = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: input });

      const response = await app.inject({
        method: 'GET',
        url: `/agents/${input.agentId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().agentId).toBe(input.agentId);
      expect(response.json().ownerUserId).toBe(input.ownerUserId);
      expect(response.json().managerUserId).toBe(input.managerUserId);
    });

    it('should return 404 for non-existent agent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/nonexistent-agent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /agents/:agentId', () => {
    it('should update agent fields and refresh updatedAt', async () => {
      const input = createTestAgent();
      const createRes = await app.inject({ method: 'POST', url: '/agents', payload: input });
      const originalUpdatedAt = createRes.json().updatedAt;

      await new Promise((r) => setTimeout(r, 50));

      const response = await app.inject({
        method: 'PATCH',
        url: `/agents/${input.agentId}`,
        payload: { purpose: 'Updated purpose' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().purpose).toBe('Updated purpose');
      expect(response.json().updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should update lifecycle state to suspended', async () => {
      const input = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: input });

      const response = await app.inject({
        method: 'PATCH',
        url: `/agents/${input.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().lifecycleState).toBe('suspended');
    });
  });

  describe('DELETE /agents/:agentId', () => {
    it('should soft-delete by setting lifecycle_state to revoked', async () => {
      const input = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: input });

      const response = await app.inject({
        method: 'DELETE',
        url: `/agents/${input.agentId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().lifecycleState).toBe('revoked');
    });

    it('should return 409 if agent is already revoked', async () => {
      const input = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: input });
      await app.inject({ method: 'DELETE', url: `/agents/${input.agentId}` });

      const response = await app.inject({
        method: 'DELETE',
        url: `/agents/${input.agentId}`,
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /agents (list with filters)', () => {
    it('should filter agents by ownerUserId', async () => {
      const owner1 = '550e8400-e29b-41d4-a716-446655440000';
      const owner2 = '660e8400-e29b-41d4-a716-446655440000';

      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: createTestAgent({ agentId: 'agent-owner1', ownerUserId: owner1 }),
      });
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: createTestAgent({ agentId: 'agent-owner2', ownerUserId: owner2 }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/agents?ownerUserId=${owner1}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].ownerUserId).toBe(owner1);
      expect(body.total).toBe(1);
    });

    it('should return paginated results', async () => {
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: createTestAgent({ agentId: `paginated-agent-${i}` }),
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/agents?limit=2&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(0);
    });
  });
});
