import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission, createTestConsent } from './helpers.js';

const WEBHOOK_SECRET = 'test-webhook-secret-min-16-chars';

describe('Lifecycle Events', () => {
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
    app.revocationSet.clear();
  });

  function postLifecycleEvent(eventType: string, userId: string, payload?: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/lifecycle-events',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { eventType, userId, ...(payload ? { payload } : {}) },
    });
  }

  async function createAgentForOwner(overrides: Record<string, unknown> = {}) {
    const input = createTestAgent({ ownerUserId: ownerId, managerUserId: managerId, ...overrides });
    await app.inject({ method: 'POST', url: '/agents', payload: input });
    return input;
  }

  async function getAgentState(agentId: string) {
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
    return res.json().lifecycleState;
  }

  // --- Webhook auth tests ---

  describe('Webhook Authentication', () => {
    it('should reject request without X-Webhook-Secret header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/lifecycle-events',
        payload: { eventType: 'user.suspended', userId: ownerId },
      });

      expect(res.statusCode).toBe(401);
    });

    it('should reject request with wrong webhook secret', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/lifecycle-events',
        headers: { 'x-webhook-secret': 'wrong-secret-value-here' },
        payload: { eventType: 'user.suspended', userId: ownerId },
      });

      expect(res.statusCode).toBe(401);
    });

    it('should accept request with correct webhook secret', async () => {
      const res = await postLifecycleEvent('user.suspended', ownerId);
      expect(res.statusCode).toBe(200);
    });
  });

  // --- Validation tests ---

  describe('Input Validation', () => {
    it('should reject invalid event type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/lifecycle-events',
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        payload: { eventType: 'user.invalid', userId: ownerId },
      });

      expect(res.statusCode).toBe(422);
    });

    it('should reject missing userId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/lifecycle-events',
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        payload: { eventType: 'user.suspended' },
      });

      expect(res.statusCode).toBe(422);
    });
  });

  // --- user.suspended tests ---

  describe('user.suspended', () => {
    it('should suspend all active agents owned by user', async () => {
      const agent1 = await createAgentForOwner();
      const agent2 = await createAgentForOwner();

      const res = await postLifecycleEvent('user.suspended', ownerId);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('processed');
      expect(body.agentsAffected).toBe(2);

      expect(await getAgentState(agent1.agentId)).toBe('suspended');
      expect(await getAgentState(agent2.agentId)).toBe('suspended');
    });

    it('should not affect agents owned by other users', async () => {
      const otherOwnerId = '550e8400-e29b-41d4-a716-446655440099';
      await createAgentForOwner();
      const otherAgent = await createAgentForOwner({ ownerUserId: otherOwnerId });

      await postLifecycleEvent('user.suspended', ownerId);

      expect(await getAgentState(otherAgent.agentId)).toBe('active');
    });

    it('should not affect already suspended agents', async () => {
      const agent = await createAgentForOwner();
      // Manually suspend
      await app.inject({
        method: 'PATCH',
        url: `/agents/${agent.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      const res = await postLifecycleEvent('user.suspended', ownerId);
      expect(res.json().agentsAffected).toBe(0);
    });

    it('should revoke tokens for suspended agents', async () => {
      const agent = await createAgentForOwner();

      // Issue a token
      const tokenRes = await app.inject({
        method: 'POST',
        url: `/agents/${agent.agentId}/token`,
        payload: { ttlMinutes: 15 },
      });
      const { accessToken } = tokenRes.json();

      await postLifecycleEvent('user.suspended', ownerId);

      // Token should now be inactive
      const introspectRes = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });
      expect(introspectRes.json().active).toBe(false);
    });

    it('should return correct event metadata', async () => {
      await createAgentForOwner();

      const res = await postLifecycleEvent('user.suspended', ownerId);
      const body = res.json();

      expect(body.eventId).toBeDefined();
      expect(body.eventType).toBe('user.suspended');
      expect(body.userId).toBe(ownerId);
      expect(body.processedAt).toBeDefined();
    });
  });

  // --- user.reactivated tests ---

  describe('user.reactivated', () => {
    it('should restore auto-suspended agents to active', async () => {
      const agent1 = await createAgentForOwner();
      const agent2 = await createAgentForOwner();

      // Suspend via lifecycle
      await postLifecycleEvent('user.suspended', ownerId);
      expect(await getAgentState(agent1.agentId)).toBe('suspended');
      expect(await getAgentState(agent2.agentId)).toBe('suspended');

      // Reactivate
      const res = await postLifecycleEvent('user.reactivated', ownerId);

      expect(res.statusCode).toBe(200);
      expect(res.json().agentsAffected).toBe(2);
      expect(await getAgentState(agent1.agentId)).toBe('active');
      expect(await getAgentState(agent2.agentId)).toBe('active');
    });

    it('should not restore manually suspended agents', async () => {
      const agent = await createAgentForOwner();

      // Manually suspend
      await app.inject({
        method: 'PATCH',
        url: `/agents/${agent.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      // Reactivate (should find no auto-suspended agents)
      const res = await postLifecycleEvent('user.reactivated', ownerId);
      expect(res.json().agentsAffected).toBe(0);
      expect(await getAgentState(agent.agentId)).toBe('suspended');
    });

    it('should handle reactivation with no suspended agents', async () => {
      await createAgentForOwner(); // active agent, not suspended

      const res = await postLifecycleEvent('user.reactivated', ownerId);
      expect(res.json().agentsAffected).toBe(0);
    });

    it('should handle mixed auto and manual suspensions', async () => {
      const autoAgent = await createAgentForOwner();
      const manualAgent = await createAgentForOwner();

      // Manually suspend one
      await app.inject({
        method: 'PATCH',
        url: `/agents/${manualAgent.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      // Auto-suspend via lifecycle (only autoAgent is active)
      await postLifecycleEvent('user.suspended', ownerId);

      // Reactivate
      const res = await postLifecycleEvent('user.reactivated', ownerId);

      // Only autoAgent should be reactivated
      expect(res.json().agentsAffected).toBe(1);
      expect(await getAgentState(autoAgent.agentId)).toBe('active');
      expect(await getAgentState(manualAgent.agentId)).toBe('suspended');
    });
  });

  // --- user.departed tests ---

  describe('user.departed', () => {
    it('should deprovision all agents owned by user', async () => {
      const agent1 = await createAgentForOwner();
      const agent2 = await createAgentForOwner();

      const res = await postLifecycleEvent('user.departed', ownerId);

      expect(res.statusCode).toBe(200);
      expect(res.json().agentsAffected).toBe(2);
      expect(await getAgentState(agent1.agentId)).toBe('deprovisioned');
      expect(await getAgentState(agent2.agentId)).toBe('deprovisioned');
    });

    it('should deprovision suspended agents too', async () => {
      const agent = await createAgentForOwner();
      await app.inject({
        method: 'PATCH',
        url: `/agents/${agent.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      await postLifecycleEvent('user.departed', ownerId);
      expect(await getAgentState(agent.agentId)).toBe('deprovisioned');
    });

    it('should revoke tokens for deprovisioned agents', async () => {
      const agent = await createAgentForOwner();
      const tokenRes = await app.inject({
        method: 'POST',
        url: `/agents/${agent.agentId}/token`,
        payload: { ttlMinutes: 15 },
      });
      const { accessToken } = tokenRes.json();

      await postLifecycleEvent('user.departed', ownerId);

      const introspectRes = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });
      expect(introspectRes.json().active).toBe(false);
    });

    it('should revoke all user consents', async () => {
      const agent = await createAgentForOwner();

      // Create permission first (required for consent)
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(agent.agentId),
      });

      // Grant consent
      const consentRes = await app.inject({
        method: 'POST',
        url: '/consents',
        payload: createTestConsent(agent.agentId, { userId: ownerId }),
      });
      const consentId = consentRes.json().id;

      await postLifecycleEvent('user.departed', ownerId);

      // Check consent is revoked
      const getRes = await app.inject({
        method: 'GET',
        url: `/consents/${consentId}`,
      });
      expect(getRes.json().status).toBe('revoked');
    });

    it('should not affect agents owned by other users', async () => {
      const otherOwnerId = '550e8400-e29b-41d4-a716-446655440099';
      const otherAgent = await createAgentForOwner({ ownerUserId: otherOwnerId });

      await postLifecycleEvent('user.departed', ownerId);

      expect(await getAgentState(otherAgent.agentId)).toBe('active');
    });

    it('should handle user with no agents', async () => {
      const res = await postLifecycleEvent('user.departed', ownerId);
      expect(res.json().agentsAffected).toBe(0);
    });
  });

  // --- user.role_changed tests ---

  describe('user.role_changed', () => {
    it('should create an ad-hoc attestation campaign', async () => {
      const agent = await createAgentForOwner();

      // Need permission for attestation items to be generated
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(agent.agentId),
      });

      const res = await postLifecycleEvent('user.role_changed', ownerId);

      expect(res.statusCode).toBe(200);
      expect(res.json().agentsAffected).toBe(1);

      // Verify campaign was created
      const campaignsRes = await app.inject({
        method: 'GET',
        url: '/attestation-campaigns?limit=10&offset=0',
      });
      const campaigns = campaignsRes.json().data;
      const lifecycleCampaign = campaigns.find((c: { name: string }) => c.name.includes('Role change review'));
      expect(lifecycleCampaign).toBeDefined();
      expect(lifecycleCampaign.frequency).toBe('ad_hoc');
    });

    it('should not create campaign when user has no active agents', async () => {
      const res = await postLifecycleEvent('user.role_changed', ownerId);
      expect(res.json().agentsAffected).toBe(0);
    });

    it('should only count active agents (not suspended)', async () => {
      const agent = await createAgentForOwner();
      await app.inject({
        method: 'PATCH',
        url: `/agents/${agent.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      const res = await postLifecycleEvent('user.role_changed', ownerId);
      expect(res.json().agentsAffected).toBe(0);
    });
  });

  // --- E2E scenario tests ---

  describe('E2E Scenarios', () => {
    it('full suspension → reactivation cycle', async () => {
      const agent = await createAgentForOwner();
      const tokenRes = await app.inject({
        method: 'POST',
        url: `/agents/${agent.agentId}/token`,
        payload: { ttlMinutes: 15 },
      });
      const { accessToken } = tokenRes.json();

      // 1. Suspend user
      const suspendRes = await postLifecycleEvent('user.suspended', ownerId);
      expect(suspendRes.json().agentsAffected).toBe(1);
      expect(await getAgentState(agent.agentId)).toBe('suspended');

      // 2. Token is revoked
      const introspect1 = await app.inject({
        method: 'POST',
        url: '/tokens/introspect',
        payload: { token: accessToken },
      });
      expect(introspect1.json().active).toBe(false);

      // 3. Reactivate user
      const reactivateRes = await postLifecycleEvent('user.reactivated', ownerId);
      expect(reactivateRes.json().agentsAffected).toBe(1);
      expect(await getAgentState(agent.agentId)).toBe('active');
    });

    it('suspension then departure prevents reactivation', async () => {
      const agent = await createAgentForOwner();

      // Suspend
      await postLifecycleEvent('user.suspended', ownerId);
      expect(await getAgentState(agent.agentId)).toBe('suspended');

      // Depart (escalates to deprovisioned)
      await postLifecycleEvent('user.departed', ownerId);
      expect(await getAgentState(agent.agentId)).toBe('deprovisioned');

      // Reactivation should have no effect
      const res = await postLifecycleEvent('user.reactivated', ownerId);
      expect(res.json().agentsAffected).toBe(0);
      expect(await getAgentState(agent.agentId)).toBe('deprovisioned');
    });

    it('multiple suspensions and reactivations', async () => {
      const agent = await createAgentForOwner();

      // First cycle
      await postLifecycleEvent('user.suspended', ownerId);
      expect(await getAgentState(agent.agentId)).toBe('suspended');
      await postLifecycleEvent('user.reactivated', ownerId);
      expect(await getAgentState(agent.agentId)).toBe('active');

      // Second cycle
      await postLifecycleEvent('user.suspended', ownerId);
      expect(await getAgentState(agent.agentId)).toBe('suspended');
      await postLifecycleEvent('user.reactivated', ownerId);
      expect(await getAgentState(agent.agentId)).toBe('active');
    });

    it('role change after suspension still creates campaign for active agents', async () => {
      const active = await createAgentForOwner();
      const suspended = await createAgentForOwner();

      // Add permissions to both
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(active.agentId),
      });
      await app.inject({
        method: 'POST',
        url: '/permissions',
        payload: createTestPermission(suspended.agentId),
      });

      // Suspend one manually
      await app.inject({
        method: 'PATCH',
        url: `/agents/${suspended.agentId}`,
        payload: { lifecycleState: 'suspended' },
      });

      // Role change - only active agents count
      const res = await postLifecycleEvent('user.role_changed', ownerId);
      expect(res.json().agentsAffected).toBe(1);
    });
  });
});
