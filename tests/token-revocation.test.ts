import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';

describe('Token Revocation & Introspection', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    app.revocationSet.clear();
  });

  async function createAgentAndGetToken(overrides: Record<string, unknown> = {}) {
    const input = createTestAgent(overrides);
    await app.inject({ method: 'POST', url: '/agents', payload: input });
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/agents/${input.agentId}/token`,
      payload: { ttlMinutes: 15 },
    });
    const { accessToken } = tokenRes.json();
    const claims = jwt.decode(accessToken) as Record<string, unknown>;
    return { input, accessToken, claims };
  }

  // --- Revoke tests ---

  describe('POST /tokens/revoke', () => {
    it('should revoke a token by JTI', async () => {
      const { claims } = await createAgentAndGetToken();

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          jti: claims.jti,
          agentId: claims.agent_id,
          revokedBy: 'admin-user',
          reason: 'compromised',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.revoked).toBe(true);
      expect(body.type).toBe('single');
      expect(body.jti).toBe(claims.jti);
    });

    it('should blanket-revoke all tokens for an agent', async () => {
      const { input } = await createAgentAndGetToken();

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          agentId: input.agentId,
          revokedBy: 'admin-user',
          reason: 'security audit',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.revoked).toBe(true);
      expect(body.type).toBe('blanket');
      expect(body.agentId).toBe(input.agentId);
    });

    it('should return 400 when neither jti nor agentId provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          revokedBy: 'admin',
          reason: 'test',
        },
      });

      expect(res.statusCode).toBe(422);
    });

    it('should return 422 when revokedBy is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          jti: 'some-jti',
          reason: 'test',
        },
      });

      expect(res.statusCode).toBe(422);
    });

    it('should return 422 when reason is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          jti: 'some-jti',
          revokedBy: 'admin',
        },
      });

      expect(res.statusCode).toBe(422);
    });
  });

  // --- Introspect tests ---

  describe('POST /tokens/introspect', () => {
    it('should return active: true for valid non-revoked token', async () => {
      const { accessToken, claims } = await createAgentAndGetToken();

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.active).toBe(true);
      expect(body.agentId).toBe(claims.agent_id);
      expect(body.ownerUserId).toBe(claims.owner_user_id);
      expect(body.managerUserId).toBe(claims.manager_user_id);
      expect(body.issuedAt).toBeDefined();
      expect(body.expiresAt).toBeDefined();
    });

    it('should return active: false for revoked token (by JTI)', async () => {
      const { accessToken, claims } = await createAgentAndGetToken();

      // Revoke it
      await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          jti: claims.jti,
          agentId: claims.agent_id,
          revokedBy: 'admin',
          reason: 'test',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.active).toBe(false);
      expect(body.revoked).toBe(true);
    });

    it('should return active: false for blanket-revoked agent token', async () => {
      const { input, accessToken } = await createAgentAndGetToken();

      // Blanket revoke
      await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          agentId: input.agentId,
          revokedBy: 'admin',
          reason: 'security audit',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(false);
      expect(res.json().revoked).toBe(true);
    });

    it('should return active: false for invalid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: 'not-a-valid-jwt' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(false);
    });

    it('should return active: false for expired token', async () => {
      // Create a manually signed expired token
      const expired = jwt.sign(
        {
          sub: 'agent-x',
          jti: 'expired-jti',
          agent_id: 'agent-x',
          owner_user_id: '550e8400-e29b-41d4-a716-446655440000',
          manager_user_id: '550e8400-e29b-41d4-a716-446655440001',
          agent_type: 'test',
          lifecycle_state: 'active',
        },
        process.env.JWT_SECRET!,
        {
          issuer: process.env.JWT_ISSUER,
          audience: process.env.JWT_AUDIENCE,
          expiresIn: -10, // already expired
        },
      );

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: expired },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(false);
    });

    it('should return active: false when agent is suspended', async () => {
      const { input, accessToken } = await createAgentAndGetToken();

      // Suspend agent
      await app.inject({
        method: 'PATCH',
        url: `/agents/${input.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.active).toBe(false);
      expect(body.agentState).toBe('suspended');
    });

    it('should return active: false when agent is revoked', async () => {
      const { input, accessToken } = await createAgentAndGetToken();

      // Revoke agent
      await app.inject({
        method: 'DELETE',
        url: `/agents/${input.agentId}`,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.active).toBe(false);
      expect(body.agentState).toBe('revoked');
    });

    it('should return active: false when agent is deprovisioned', async () => {
      const { input, accessToken } = await createAgentAndGetToken();

      // Deprovision agent
      await app.inject({
        method: 'PATCH',
        url: `/agents/${input.agentId}`,
        payload: { lifecycleState: 'deprovisioned' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.active).toBe(false);
      expect(body.agentState).toBe('deprovisioned');
    });

    it('should return 400 when token field is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: {},
      });

      expect(res.statusCode).toBe(422);
    });

    it('should not cross-contaminate blanket revocation between agents', async () => {
      const agent1 = await createAgentAndGetToken();
      const agent2 = await createAgentAndGetToken();

      // Blanket revoke agent1 only
      await app.inject({
        method: 'POST',
        url: '/tokens/revoke',
        payload: {
          agentId: agent1.input.agentId,
          revokedBy: 'admin',
          reason: 'security',
        },
      });

      // Agent1 token should be revoked
      const res1 = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: agent1.accessToken },
      });
      expect(res1.json().active).toBe(false);
      expect(res1.json().revoked).toBe(true);

      // Agent2 token should still be active
      const res2 = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: agent2.accessToken },
      });
      expect(res2.json().active).toBe(true);
    });
  });
});
