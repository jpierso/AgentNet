import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent, createTestPermission, createTestCampaign } from './helpers.js';

describe('Attestation Campaigns & Items', () => {
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

  async function seedCampaign(overrides = {}) {
    const input = createTestCampaign(overrides);
    const res = await app.inject({ method: 'POST', url: '/attestation-campaigns', payload: input });
    return res.json();
  }

  describe('POST /attestation-campaigns', () => {
    it('should create a campaign and auto-generate items', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'documents', allowedActions: ['read'] });

      const result = await seedCampaign();

      expect(result.campaign).toBeDefined();
      expect(result.campaign.name).toBe('Q1 2026 Access Review');
      expect(result.campaign.status).toBe('active');
      expect(result.campaign.frequency).toBe('quarterly');
      expect(result.itemsGenerated).toBe(1); // tier_0 => owner only
    });

    it('should generate dual items for tier_2+ permissions', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, {
        resource: 'billing',
        allowedActions: ['write'],
        actionTier: 'tier_2',
      });

      const result = await seedCampaign();

      expect(result.itemsGenerated).toBe(2); // owner + manager
    });

    it('should generate items only for sensitive permissions with sensitive_only scope', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'], actionTier: 'tier_0' });
      await seedPermission(agent.agentId, { resource: 'billing', allowedActions: ['write'], actionTier: 'tier_2' });

      const result = await seedCampaign({ scope: 'sensitive_only' });

      // Only tier_2 permission: 2 items (owner + manager)
      expect(result.itemsGenerated).toBe(2);
    });

    it('should not generate items for revoked agents', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });
      // Revoke the agent
      await app.inject({ method: 'DELETE', url: `/agents/${agent.agentId}` });

      const result = await seedCampaign();

      expect(result.itemsGenerated).toBe(0);
    });

    it('should scope to specific agents when specific_agents scope used', async () => {
      const agent1 = await seedAgent();
      const agent2 = await seedAgent();
      await seedPermission(agent1.agentId, { resource: 'docs', allowedActions: ['read'] });
      await seedPermission(agent2.agentId, { resource: 'docs', allowedActions: ['read'] });

      const result = await seedCampaign({
        scope: 'specific_agents',
        scopeFilter: { agentIds: [agent1.agentId] },
      });

      expect(result.itemsGenerated).toBe(1);
    });

    it('should return 422 for missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/attestation-campaigns',
        payload: {},
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('GET /attestation-campaigns', () => {
    it('should list all campaigns', async () => {
      await seedCampaign({ name: 'Campaign 1' });
      await seedCampaign({ name: 'Campaign 2' });

      const res = await app.inject({ method: 'GET', url: '/attestation-campaigns' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(2);
      expect(res.json().total).toBe(2);
    });

    it('should filter by status', async () => {
      const { campaign } = await seedCampaign({ name: 'Active Campaign' });
      const { campaign: campaign2 } = await seedCampaign({ name: 'To Cancel' });
      await app.inject({ method: 'POST', url: `/attestation-campaigns/${campaign2.id}/cancel` });

      const res = await app.inject({ method: 'GET', url: '/attestation-campaigns?status=active' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].name).toBe('Active Campaign');
    });
  });

  describe('GET /attestation-campaigns/:campaignId', () => {
    it('should return a campaign by ID', async () => {
      const { campaign } = await seedCampaign();

      const res = await app.inject({ method: 'GET', url: `/attestation-campaigns/${campaign.id}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(campaign.id);
    });

    it('should return 404 for non-existent campaign', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/attestation-campaigns/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /attestation-campaigns/:campaignId/progress', () => {
    it('should return progress with all items pending initially', async () => {
      const agent = await seedAgent();
      await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });

      const { campaign } = await seedCampaign();

      const res = await app.inject({
        method: 'GET',
        url: `/attestation-campaigns/${campaign.id}/progress`,
      });

      expect(res.statusCode).toBe(200);
      const progress = res.json();
      expect(progress.total).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.attested).toBe(0);
      expect(progress.rejected).toBe(0);
      expect(progress.autoSuspended).toBe(0);
    });
  });

  describe('POST /attestation-campaigns/:campaignId/cancel', () => {
    it('should cancel an active campaign', async () => {
      const { campaign } = await seedCampaign();

      const res = await app.inject({
        method: 'POST',
        url: `/attestation-campaigns/${campaign.id}/cancel`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
    });

    it('should return 409 for already cancelled campaign', async () => {
      const { campaign } = await seedCampaign();
      await app.inject({ method: 'POST', url: `/attestation-campaigns/${campaign.id}/cancel` });

      const res = await app.inject({
        method: 'POST',
        url: `/attestation-campaigns/${campaign.id}/cancel`,
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /attestation-campaigns/:campaignId/process-expired', () => {
    it('should auto-suspend pending items and expire permissions', async () => {
      const agent = await seedAgent();
      const perm = await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });

      // Create an already-expired campaign
      const { campaign } = await seedCampaign({
        dueDate: new Date(Date.now() - 1000).toISOString(),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/attestation-campaigns/${campaign.id}/process-expired`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().suspendedCount).toBe(1);

      // Verify the item is now auto_suspended
      const itemsRes = await app.inject({
        method: 'GET',
        url: `/attestation-items?campaignId=${campaign.id}`,
      });
      expect(itemsRes.json().data[0].status).toBe('auto_suspended');

      // Verify the permission is now expired
      const permRes = await app.inject({
        method: 'GET',
        url: `/permissions/${perm.id}`,
      });
      expect(new Date(permRes.json().expiresAt).getTime()).toBeLessThanOrEqual(Date.now());

      // Verify campaign is completed
      const campaignRes = await app.inject({
        method: 'GET',
        url: `/attestation-campaigns/${campaign.id}`,
      });
      expect(campaignRes.json().status).toBe('completed');
    });

    it('should return 422 for a campaign that has not yet expired', async () => {
      const { campaign } = await seedCampaign(); // due date is 90 days in future

      const res = await app.inject({
        method: 'POST',
        url: `/attestation-campaigns/${campaign.id}/process-expired`,
      });

      expect(res.statusCode).toBe(422);
    });
  });

  describe('Attestation Items', () => {
    describe('GET /attestation-items', () => {
      it('should list items filtered by campaign', async () => {
        const agent = await seedAgent();
        await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });

        const { campaign } = await seedCampaign();

        const res = await app.inject({
          method: 'GET',
          url: `/attestation-items?campaignId=${campaign.id}`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().data).toHaveLength(1);
        expect(res.json().data[0].reviewerRole).toBe('owner');
      });

      it('should list items filtered by reviewer', async () => {
        const agent = await seedAgent();
        await seedPermission(agent.agentId, { resource: 'billing', allowedActions: ['write'], actionTier: 'tier_2' });

        await seedCampaign();

        const ownerRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?reviewerUserId=${ownerId}`,
        });
        expect(ownerRes.json().data).toHaveLength(1);

        const managerRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?reviewerUserId=${managerId}`,
        });
        expect(managerRes.json().data).toHaveLength(1);
      });
    });

    describe('GET /attestation-items/:itemId', () => {
      it('should return an item by ID', async () => {
        const agent = await seedAgent();
        await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });
        const { campaign } = await seedCampaign();

        const itemsRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?campaignId=${campaign.id}`,
        });
        const itemId = itemsRes.json().data[0].id;

        const res = await app.inject({ method: 'GET', url: `/attestation-items/${itemId}` });

        expect(res.statusCode).toBe(200);
        expect(res.json().id).toBe(itemId);
        expect(res.json().permissionSnapshot).toBeDefined();
      });

      it('should return 404 for non-existent item', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/attestation-items/00000000-0000-0000-0000-000000000000',
        });
        expect(res.statusCode).toBe(404);
      });
    });

    describe('POST /attestation-items/:itemId/review', () => {
      it('should confirm an attestation item', async () => {
        const agent = await seedAgent();
        await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });
        const { campaign } = await seedCampaign();

        const itemsRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?campaignId=${campaign.id}`,
        });
        const itemId = itemsRes.json().data[0].id;

        const res = await app.inject({
          method: 'POST',
          url: `/attestation-items/${itemId}/review`,
          payload: {
            decision: 'confirm',
            decisionNote: 'Looks good',
            reviewerUserId: ownerId,
          },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('attested');
        expect(res.json().decision).toBe('confirm');
        expect(res.json().decidedAt).toBeTruthy();
      });

      it('should revoke an attestation item and expire the permission', async () => {
        const agent = await seedAgent();
        const perm = await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });
        const { campaign } = await seedCampaign();

        const itemsRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?campaignId=${campaign.id}`,
        });
        const itemId = itemsRes.json().data[0].id;

        const res = await app.inject({
          method: 'POST',
          url: `/attestation-items/${itemId}/review`,
          payload: {
            decision: 'revoke',
            reviewerUserId: ownerId,
          },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('rejected');

        // Verify permission is expired
        const permRes = await app.inject({ method: 'GET', url: `/permissions/${perm.id}` });
        expect(permRes.json().expiresAt).toBeTruthy();
      });

      it('should return 409 for already reviewed item', async () => {
        const agent = await seedAgent();
        await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });
        const { campaign } = await seedCampaign();

        const itemsRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?campaignId=${campaign.id}`,
        });
        const itemId = itemsRes.json().data[0].id;

        await app.inject({
          method: 'POST',
          url: `/attestation-items/${itemId}/review`,
          payload: { decision: 'confirm', reviewerUserId: ownerId },
        });

        const res = await app.inject({
          method: 'POST',
          url: `/attestation-items/${itemId}/review`,
          payload: { decision: 'confirm', reviewerUserId: ownerId },
        });

        expect(res.statusCode).toBe(409);
      });

      it('should return 403 for wrong reviewer', async () => {
        const agent = await seedAgent();
        await seedPermission(agent.agentId, { resource: 'docs', allowedActions: ['read'] });
        const { campaign } = await seedCampaign();

        const itemsRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?campaignId=${campaign.id}`,
        });
        const itemId = itemsRes.json().data[0].id;

        const res = await app.inject({
          method: 'POST',
          url: `/attestation-items/${itemId}/review`,
          payload: {
            decision: 'confirm',
            reviewerUserId: '550e8400-e29b-41d4-a716-446655440099',
          },
        });

        expect(res.statusCode).toBe(403);
      });

      it('should update progress after reviews', async () => {
        const agent = await seedAgent();
        await seedPermission(agent.agentId, { resource: 'billing', allowedActions: ['write'], actionTier: 'tier_2' });
        const { campaign } = await seedCampaign();

        // Review the owner item
        const itemsRes = await app.inject({
          method: 'GET',
          url: `/attestation-items?campaignId=${campaign.id}&reviewerUserId=${ownerId}`,
        });
        const ownerItemId = itemsRes.json().data[0].id;

        await app.inject({
          method: 'POST',
          url: `/attestation-items/${ownerItemId}/review`,
          payload: { decision: 'confirm', reviewerUserId: ownerId },
        });

        const progressRes = await app.inject({
          method: 'GET',
          url: `/attestation-campaigns/${campaign.id}/progress`,
        });

        const progress = progressRes.json();
        expect(progress.total).toBe(2);
        expect(progress.attested).toBe(1);
        expect(progress.pending).toBe(1); // manager item still pending
      });
    });
  });
});
