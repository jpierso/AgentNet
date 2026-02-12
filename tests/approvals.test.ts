import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';
import { ApprovalService } from '../src/services/approval.service.js';

describe('Approvals', () => {
  let app: FastifyInstance;
  let testAgentId: string;
  let approvalService: ApprovalService;

  beforeAll(async () => {
    app = await buildTestApp();
    approvalService = new ApprovalService(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    const agent = createTestAgent();
    testAgentId = agent.agentId;
    await app.inject({ method: 'POST', url: '/agents', payload: agent });
  });

  function createApprovalInput(overrides: Record<string, unknown> = {}) {
    return {
      agentId: testAgentId,
      requestedBy: 'system',
      requestedScopes: ['documents:read', 'documents:list'],
      grantedPermissions: [{ resource: 'documents', actions: ['read', 'list'], tier: 'tier_2' }],
      parentTokenJti: 'jti-123',
      ttlMinutes: 15,
      ...overrides,
    };
  }

  // --- Service layer ---

  describe('ApprovalService', () => {
    it('should create an approval request', async () => {
      const approval = await approvalService.create(createApprovalInput());
      expect(approval.id).toBeDefined();
      expect(approval.status).toBe('pending');
      expect(approval.agentId).toBe(testAgentId);
    });

    it('should set default expiry to 30 minutes', async () => {
      const before = Date.now();
      const approval = await approvalService.create(createApprovalInput());
      const expiresAt = approval.expiresAt.getTime();
      // Should be roughly 30 minutes from now (28-32 min tolerance)
      expect(expiresAt - before).toBeGreaterThan(28 * 60 * 1000);
      expect(expiresAt - before).toBeLessThan(32 * 60 * 1000);
    });

    it('should allow custom expiry', async () => {
      const before = Date.now();
      const approval = await approvalService.create(createApprovalInput({ expiresInMinutes: 10 }));
      const expiresAt = approval.expiresAt.getTime();
      expect(expiresAt - before).toBeGreaterThan(8 * 60 * 1000);
      expect(expiresAt - before).toBeLessThan(12 * 60 * 1000);
    });

    it('should review (approve) an approval', async () => {
      const approval = await approvalService.create(createApprovalInput());
      const reviewed = await approvalService.review(approval.id, {
        decision: 'approved',
        reviewedBy: 'manager-user-1',
        note: 'Looks good',
      });
      expect(reviewed.status).toBe('approved');
      expect(reviewed.reviewedBy).toBe('manager-user-1');
      expect(reviewed.reviewNote).toBe('Looks good');
      expect(reviewed.reviewedAt).toBeTruthy();
    });

    it('should review (deny) an approval', async () => {
      const approval = await approvalService.create(createApprovalInput());
      const reviewed = await approvalService.review(approval.id, {
        decision: 'denied',
        reviewedBy: 'manager-user-1',
      });
      expect(reviewed.status).toBe('denied');
    });

    it('should reject review of already-reviewed approval', async () => {
      const approval = await approvalService.create(createApprovalInput());
      await approvalService.review(approval.id, {
        decision: 'approved',
        reviewedBy: 'manager-user-1',
      });

      await expect(
        approvalService.review(approval.id, {
          decision: 'denied',
          reviewedBy: 'manager-user-2',
        }),
      ).rejects.toThrow('already');
    });

    it('should auto-expire pending approvals past expiresAt', async () => {
      const approval = await approvalService.create(
        createApprovalInput({ expiresInMinutes: 0 }), // immediate expiry
      );

      // Wait a tiny bit for the expiry to be in the past
      await new Promise((r) => setTimeout(r, 50));

      const fetched = await approvalService.getById(approval.id);
      expect(fetched.status).toBe('expired');
    });

    it('should reject review of expired approval', async () => {
      const approval = await approvalService.create(
        createApprovalInput({ expiresInMinutes: 0 }),
      );
      await new Promise((r) => setTimeout(r, 50));

      await expect(
        approvalService.review(approval.id, {
          decision: 'approved',
          reviewedBy: 'manager-user-1',
        }),
      ).rejects.toThrow('already');
    });

    it('should validate approval for exchange (happy path)', async () => {
      const approval = await approvalService.create(createApprovalInput());
      await approvalService.review(approval.id, {
        decision: 'approved',
        reviewedBy: 'manager-user-1',
      });

      const validated = await approvalService.validateForExchange(
        approval.id,
        testAgentId,
        ['documents:read', 'documents:list'],
      );
      expect(validated.status).toBe('approved');
    });

    it('should reject exchange for pending approval', async () => {
      const approval = await approvalService.create(createApprovalInput());
      await expect(
        approvalService.validateForExchange(approval.id, testAgentId, ['documents:read']),
      ).rejects.toThrow("status is 'pending'");
    });

    it('should reject exchange for wrong agent', async () => {
      const approval = await approvalService.create(createApprovalInput());
      await approvalService.review(approval.id, {
        decision: 'approved',
        reviewedBy: 'manager-user-1',
      });

      await expect(
        approvalService.validateForExchange(approval.id, 'wrong-agent', ['documents:read']),
      ).rejects.toThrow('does not match');
    });

    it('should reject exchange for mismatched scopes', async () => {
      const approval = await approvalService.create(createApprovalInput());
      await approvalService.review(approval.id, {
        decision: 'approved',
        reviewedBy: 'manager-user-1',
      });

      await expect(
        approvalService.validateForExchange(approval.id, testAgentId, ['billing:delete']),
      ).rejects.toThrow('do not match');
    });

    it('should batch-expire pending approvals', async () => {
      await approvalService.create(createApprovalInput({ expiresInMinutes: 0 }));
      await approvalService.create(createApprovalInput({ expiresInMinutes: 0 }));
      await new Promise((r) => setTimeout(r, 50));

      const count = await approvalService.expirePending();
      expect(count).toBe(2);
    });
  });

  // --- HTTP endpoints ---

  describe('Approval Routes', () => {
    it('should get approval by ID', async () => {
      const approval = await approvalService.create(createApprovalInput());

      const res = await app.inject({
        method: 'GET',
        url: `/approvals/${approval.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(approval.id);
      expect(res.json().status).toBe('pending');
    });

    it('should return 404 for non-existent approval', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/approvals/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should approve via review endpoint', async () => {
      const approval = await approvalService.create(createApprovalInput());

      const res = await app.inject({
        method: 'POST',
        url: `/approvals/${approval.id}/review`,
        payload: {
          decision: 'approved',
          reviewedBy: 'manager-user-1',
          note: 'Approved for testing',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('approved');
      expect(res.json().reviewedBy).toBe('manager-user-1');
    });

    it('should deny via review endpoint', async () => {
      const approval = await approvalService.create(createApprovalInput());

      const res = await app.inject({
        method: 'POST',
        url: `/approvals/${approval.id}/review`,
        payload: {
          decision: 'denied',
          reviewedBy: 'manager-user-1',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('denied');
    });

    it('should return 409 when reviewing already-reviewed approval', async () => {
      const approval = await approvalService.create(createApprovalInput());

      await app.inject({
        method: 'POST',
        url: `/approvals/${approval.id}/review`,
        payload: { decision: 'approved', reviewedBy: 'manager-user-1' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/approvals/${approval.id}/review`,
        payload: { decision: 'denied', reviewedBy: 'manager-user-2' },
      });

      expect(res.statusCode).toBe(409);
    });
  });
});
