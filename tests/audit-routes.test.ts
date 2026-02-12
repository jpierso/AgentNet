import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase } from './helpers.js';
import { ActorTypes, AuditActions, Outcomes, ResourceTypes } from '../src/services/audit-events.js';

describe('Audit Query Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);

    // Seed audit events directly
    await app.auditService.recordBatch([
      {
        traceId: 'route-trace-1',
        agentId: 'agent-x',
        actorType: ActorTypes.USER,
        actorId: 'user-1',
        action: AuditActions.AGENT_CREATED,
        resource: 'agent:agent-x',
        resourceType: ResourceTypes.AGENT,
        outcome: Outcomes.SUCCESS,
      },
      {
        traceId: 'route-trace-1',
        agentId: 'agent-x',
        actorType: ActorTypes.USER,
        actorId: 'user-1',
        action: AuditActions.TOKEN_ISSUED,
        resource: 'token:agent-x',
        resourceType: ResourceTypes.TOKEN,
        outcome: Outcomes.SUCCESS,
      },
      {
        traceId: 'route-trace-2',
        agentId: 'agent-y',
        actorType: ActorTypes.USER,
        actorId: 'user-2',
        action: AuditActions.AGENT_CREATED,
        resource: 'agent:agent-y',
        resourceType: ResourceTypes.AGENT,
        outcome: Outcomes.FAILURE,
        outcomeReason: 'Validation error',
      },
    ]);
  });

  describe('GET /audit-events', () => {
    it('should return all audit events with pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit-events',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // At least our 3 seeded events (plus any http.request events from the hook)
      expect(body.data.length).toBeGreaterThanOrEqual(3);
      expect(body.total).toBeGreaterThanOrEqual(3);
    });

    it('should filter by agentId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit-events?agentId=agent-x',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.data.every((e: { agentId: string }) => e.agentId === 'agent-x')).toBe(true);
    });

    it('should filter by action', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/audit-events?action=${AuditActions.AGENT_CREATED}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
    });

    it('should filter by outcome', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit-events?outcome=failure',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].outcome).toBe('failure');
    });

    it('should support limit and offset', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit-events?limit=1&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.limit).toBe(1);
      expect(body.offset).toBe(0);
    });
  });

  describe('GET /audit-events/trace/:traceId', () => {
    it('should return all events for a trace', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit-events/trace/route-trace-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.traceId).toBe('route-trace-1');
      expect(body.events).toHaveLength(2);
      expect(body.events.every((e: { traceId: string }) => e.traceId === 'route-trace-1')).toBe(true);
    });

    it('should return empty events for unknown trace', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit-events/trace/unknown-trace',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.events).toHaveLength(0);
    });
  });
});
