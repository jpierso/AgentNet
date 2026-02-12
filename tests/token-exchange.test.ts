import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission } from './helpers.js';

describe('Token Exchange', () => {
  let app: FastifyInstance;
  let testAgentId: string;
  let parentToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    app.revocationSet.clear();

    // Create agent
    const agent = createTestAgent();
    testAgentId = agent.agentId;
    await app.inject({ method: 'POST', url: '/agents', payload: agent });

    // Create permissions
    await app.inject({
      method: 'POST',
      url: '/permissions',
      payload: createTestPermission(testAgentId, {
        resource: 'documents',
        allowedActions: ['read', 'list'],
        actionTier: 'tier_0',
      }),
    });
    await app.inject({
      method: 'POST',
      url: '/permissions',
      payload: createTestPermission(testAgentId, {
        resource: 'documents',
        allowedActions: ['create', 'update'],
        actionTier: 'tier_1',
      }),
    });

    // Issue parent token
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token`,
      payload: { ttlMinutes: 30 },
    });
    parentToken = tokenRes.json().accessToken;
  });

  it('should exchange a token for a downscoped token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read', 'documents:list'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tokenKind).toBe('downscoped');
    expect(body.scope).toEqual(['documents:read', 'documents:list']);
    expect(body.accessToken).toBeDefined();
    expect(body.expiresIn).toBeLessThanOrEqual(15 * 60);
  });

  it('should include correct claims in downscoped JWT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 10,
      },
    });

    const body = response.json();
    const decoded = jwt.decode(body.accessToken) as Record<string, unknown>;

    expect(decoded.token_type).toBe('downscoped');
    expect(decoded.agent_id).toBe(testAgentId);
    expect(decoded.parent_token_jti).toBeDefined();
    expect(decoded.scope).toEqual(['documents:read']);
    expect(decoded.permissions).toBeDefined();
    expect(Array.isArray(decoded.permissions)).toBe(true);
  });

  it('should deny scope exceeding permission boundaries', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read', 'billing:delete'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.details.denied).toBeDefined();
    expect(body.details.denied).toHaveLength(1);
    expect(body.details.denied[0].scope).toBe('billing:delete');
  });

  it('should deny entirely invalid scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['invalid-no-colon'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should reject mismatched agent ID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/wrong-agent-id/token/exchange',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('does not match');
  });

  it('should reject invalid subject token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'invalid.jwt.token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should reject token for suspended agent', async () => {
    // Suspend the agent
    await app.inject({
      method: 'PATCH',
      url: `/agents/${testAgentId}`,
      payload: { lifecycleState: 'suspended' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('suspended');
  });

  it('should cap TTL at parent token remaining time', async () => {
    // Issue a parent token with 1 minute TTL
    const shortTokenRes = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token`,
      payload: { ttlMinutes: 1 },
    });
    const shortToken = shortTokenRes.json().accessToken;

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: shortToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 60, // Request 60 min but parent only has ~1 min left
      },
    });

    expect(response.statusCode).toBe(200);
    // Should be capped to roughly 60 seconds (with some tolerance for test execution time)
    expect(response.json().expiresIn).toBeLessThanOrEqual(60);
  });

  it('should reject request with missing required scope field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('should not allow scope with expired permission boundary', async () => {
    // Create a permission that already expired
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    await app.inject({
      method: 'POST',
      url: '/permissions',
      payload: createTestPermission(testAgentId, {
        resource: 'expired-resource',
        allowedActions: ['read'],
        actionTier: 'tier_0',
        expiresAt: pastDate,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['expired-resource:read'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should allow multi-tier scopes in a single exchange', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read', 'documents:create'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().scope).toEqual(['documents:read', 'documents:create']);
  });

  it('should reject exchange when parent token JTI is revoked', async () => {
    const parentClaims = jwt.decode(parentToken) as Record<string, unknown>;

    // Revoke the parent token
    await app.inject({
      method: 'POST',
      url: '/tokens/revoke',
      payload: {
        jti: parentClaims.jti,
        agentId: testAgentId,
        revokedBy: 'admin',
        reason: 'compromised',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain('revoked');
  });

  it('should reject exchange when agent has blanket token revocation', async () => {
    // Blanket revoke all tokens for the agent
    await app.inject({
      method: 'POST',
      url: '/tokens/revoke',
      payload: {
        agentId: testAgentId,
        revokedBy: 'admin',
        reason: 'security audit',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain('revoked');
  });

  it('should succeed exchange with non-revoked token after different agent revoked', async () => {
    // Create a second agent and revoke its tokens
    const agent2 = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: agent2 });
    await app.inject({
      method: 'POST',
      url: '/tokens/revoke',
      payload: {
        agentId: agent2.agentId,
        revokedBy: 'admin',
        reason: 'test',
      },
    });

    // Original agent's token should still work
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${testAgentId}/token/exchange`,
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: parentToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: ['documents:read'],
        ttlMinutes: 15,
      },
    });

    expect(response.statusCode).toBe(200);
  });
});
