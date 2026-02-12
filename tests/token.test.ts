import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';

describe('Token Issuance', () => {
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

  it('should issue a JWT for an active agent', async () => {
    const input = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: input });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${input.agentId}/token`,
      payload: { ttlMinutes: 15 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.accessToken).toBeDefined();
    expect(body.expiresAt).toBeDefined();

    // Decode and verify claims
    const decoded = jwt.decode(body.accessToken) as Record<string, unknown>;
    expect(decoded.agent_id).toBe(input.agentId);
    expect(decoded.owner_user_id).toBe(input.ownerUserId);
    expect(decoded.manager_user_id).toBe(input.managerUserId);
    expect(decoded.agent_type).toBe(input.agentType);
    expect(decoded.lifecycle_state).toBe('active');
  });

  it('should reject token issuance for suspended agent', async () => {
    const input = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: input });
    await app.inject({
      method: 'PATCH',
      url: `/agents/${input.agentId}`,
      payload: { lifecycleState: 'suspended' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${input.agentId}/token`,
      payload: { ttlMinutes: 15 },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should reject token issuance for revoked agent', async () => {
    const input = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: input });
    await app.inject({ method: 'DELETE', url: `/agents/${input.agentId}` });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${input.agentId}/token`,
      payload: { ttlMinutes: 15 },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should return 404 for non-existent agent', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/nonexistent/token',
      payload: { ttlMinutes: 15 },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should use default TTL when body is empty', async () => {
    const input = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: input });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${input.agentId}/token`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().expiresIn).toBe(900); // default 15 min
  });
});
