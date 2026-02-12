import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission, createTestCampaign } from './helpers.js';

describe('Drift Detection', () => {
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

  /** Create campaign, attest all owner items, return campaign */
  async function seedAttestedCampaign(overrides = {}) {
    const campaignInput = createTestCampaign(overrides);
    const createRes = await app.inject({
      method: 'POST',
      url: '/attestation-campaigns',
      payload: campaignInput,
    });
    const { campaign } = createRes.json();

    // Attest all owner items
    const itemsRes = await app.inject({
      method: 'GET',
      url: `/attestation-items?campaignId=${campaign.id}&reviewerUserId=${ownerId}`,
    });

    for (const item of itemsRes.json().data) {
      await app.inject({
        method: 'POST',
        url: `/attestation-items/${item.id}/review`,
        payload: { decision: 'confirm', reviewerUserId: ownerId },
      });
    }

    // Attest all manager items
    const managerItemsRes = await app.inject({
      method: 'GET',
      url: `/attestation-items?campaignId=${campaign.id}&reviewerUserId=${managerId}&status=pending`,
    });

    for (const item of managerItemsRes.json().data) {
      await app.inject({
        method: 'POST',
        url: `/attestation-items/${item.id}/review`,
        payload: { decision: 'confirm', reviewerUserId: managerId },
      });
    }

    return campaign;
  }

  describe('GET /drift-detection/agents/:agentId', () => {
    it('should report no drift when nothing changed since attestation', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });
      await seedAttestedCampaign();

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection/agents/${agent.agentId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hasDrift).toBe(false);
      expect(body.drifts).toHaveLength(0);
      expect(body.baselineCampaignId).toBeTruthy();
    });

    it('should detect added permissions', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });
      await seedAttestedCampaign();

      // Add a new permission after attestation
      await seedPermission(agent.agentId, { resource: 'billing', allowedActions: ['read'], actionTier: 'tier_1' });

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection/agents/${agent.agentId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hasDrift).toBe(true);
      expect(body.drifts).toHaveLength(1);
      expect(body.drifts[0].driftType).toBe('added');
      expect(body.drifts[0].resource).toBe('billing');
      expect(body.drifts[0].baseline).toBeNull();
      expect(body.drifts[0].current).toBeTruthy();
    });

    it('should detect removed permissions', async () => {
      const agent = await seedAgent();
      const perm = await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });
      await seedAttestedCampaign();

      // Delete the permission
      await app.inject({ method: 'DELETE', url: `/permissions/${perm.id}` });

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection/agents/${agent.agentId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hasDrift).toBe(true);
      expect(body.drifts).toHaveLength(1);
      expect(body.drifts[0].driftType).toBe('removed');
      expect(body.drifts[0].resource).toBe('documents');
      expect(body.drifts[0].current).toBeNull();
    });

    it('should detect modified permissions', async () => {
      const agent = await seedAgent();
      const perm = await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });
      await seedAttestedCampaign();

      // Modify the permission
      await app.inject({
        method: 'PATCH',
        url: `/permissions/${perm.id}`,
        payload: { allowedActions: ['read', 'write'] },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection/agents/${agent.agentId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hasDrift).toBe(true);
      expect(body.drifts).toHaveLength(1);
      expect(body.drifts[0].driftType).toBe('modified');
      expect(body.drifts[0].resource).toBe('documents');
    });

    it('should report no drift when there is no attestation baseline', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection/agents/${agent.agentId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // All current permissions are "added" relative to empty baseline
      expect(body.hasDrift).toBe(true);
      expect(body.drifts[0].driftType).toBe('added');
      expect(body.baselineCampaignId).toBeNull();
    });

    it('should report no drift for agent with no permissions and no baseline', async () => {
      const agent = await seedAgent();

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection/agents/${agent.agentId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().hasDrift).toBe(false);
      expect(res.json().drifts).toHaveLength(0);
    });

    it('should detect multiple drift types simultaneously', async () => {
      const agent = await seedAgent();
      const perm1 = await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });
      const perm2 = await seedPermission(agent.agentId, { resource: 'emails', allowedActions: ['read'], actionTier: 'tier_1' });
      await seedAttestedCampaign();

      // Delete perm1, modify perm2, add perm3
      await app.inject({ method: 'DELETE', url: `/permissions/${perm1.id}` });
      await app.inject({ method: 'PATCH', url: `/permissions/${perm2.id}`, payload: { allowedActions: ['read', 'send'] } });
      await seedPermission(agent.agentId, { resource: 'billing', allowedActions: ['read'], actionTier: 'tier_1' });

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection/agents/${agent.agentId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hasDrift).toBe(true);
      expect(body.drifts).toHaveLength(3);

      const types = body.drifts.map((d: { driftType: string }) => d.driftType).sort();
      expect(types).toEqual(['added', 'modified', 'removed']);
    });
  });

  describe('GET /drift-detection', () => {
    it('should return drift summary for all agents', async () => {
      const agent1 = await seedAgent();
      const agent2 = await seedAgent();
      await seedPermission(agent1.agentId, { resource: 'documents', allowedActions: ['read'] });
      await seedPermission(agent2.agentId, { resource: 'billing', allowedActions: ['read'], actionTier: 'tier_1' });

      const res = await app.inject({ method: 'GET', url: '/drift-detection' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.agents).toHaveLength(2);
      expect(body.detectedAt).toBeDefined();
    });

    it('should filter by ownerUserId', async () => {
      const otherOwner = '550e8400-e29b-41d4-a716-446655440099';
      await seedAgent();
      await seedAgent({ ownerUserId: otherOwner });

      const res = await app.inject({
        method: 'GET',
        url: `/drift-detection?ownerUserId=${ownerId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(1);
    });

    it('should return empty for user with no agents', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/drift-detection?ownerUserId=550e8400-e29b-41d4-a716-446655440099',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(0);
    });

    it('should correctly identify agents with and without drift', async () => {
      const agent1 = await seedAgent();
      const agent2 = await seedAgent();
      await seedPermission(agent1.agentId, { resource: 'documents', allowedActions: ['read'] });
      await seedPermission(agent2.agentId, { resource: 'billing', allowedActions: ['read'], actionTier: 'tier_1' });
      await seedAttestedCampaign();

      // Modify only agent1's permission
      const permRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent1.agentId}/permissions`,
      });
      const permId = permRes.json().data[0].id;
      await app.inject({
        method: 'PATCH',
        url: `/permissions/${permId}`,
        payload: { allowedActions: ['read', 'write'] },
      });

      const res = await app.inject({ method: 'GET', url: '/drift-detection' });

      const body = res.json();
      const agent1Drift = body.agents.find((a: { agentId: string }) => a.agentId === agent1.agentId);
      const agent2Drift = body.agents.find((a: { agentId: string }) => a.agentId === agent2.agentId);

      expect(agent1Drift.hasDrift).toBe(true);
      expect(agent2Drift.hasDrift).toBe(false);
    });
  });
});
