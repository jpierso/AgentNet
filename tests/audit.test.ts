import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../src/services/audit-events.js';

describe('Audit Service', () => {
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

  describe('record()', () => {
    it('should record an audit event', async () => {
      const event = await app.auditService.record({
        traceId: 'test-trace-001',
        actorType: ActorTypes.SYSTEM,
        actorId: 'test-runner',
        action: AuditActions.AGENT_CREATED,
        resource: 'agent:test-agent',
        resourceType: ResourceTypes.AGENT,
        outcome: Outcomes.SUCCESS,
      });

      expect(event.id).toBeDefined();
      expect(event.traceId).toBe('test-trace-001');
      expect(event.action).toBe('agent.created');
      expect(event.outcome).toBe('success');
    });

    it('should record an event with all optional fields', async () => {
      const event = await app.auditService.record({
        traceId: 'test-trace-002',
        spanId: 'span-001',
        parentSpanId: 'span-000',
        agentId: 'my-agent',
        actorType: ActorTypes.AGENT,
        actorId: 'my-agent',
        action: AuditActions.TOKEN_ISSUED,
        resource: 'token:my-agent',
        resourceType: ResourceTypes.TOKEN,
        outcome: Outcomes.SUCCESS,
        metadata: { ttl: 15 },
        requestMethod: 'POST',
        requestPath: '/agents/my-agent/token',
        requestId: 'req-001',
        statusCode: 200,
        durationMs: 42,
        ipAddress: '127.0.0.1',
        userAgent: 'test-client/1.0',
      });

      expect(event.spanId).toBe('span-001');
      expect(event.parentSpanId).toBe('span-000');
      expect(event.agentId).toBe('my-agent');
      expect(event.metadata).toEqual({ ttl: 15 });
      expect(event.durationMs).toBe(42);
    });
  });

  describe('recordBatch()', () => {
    it('should record multiple events at once', async () => {
      const events = await app.auditService.recordBatch([
        {
          traceId: 'batch-trace',
          actorType: ActorTypes.SYSTEM,
          actorId: 'test',
          action: AuditActions.AGENT_CREATED,
          resource: 'agent:a',
          resourceType: ResourceTypes.AGENT,
          outcome: Outcomes.SUCCESS,
        },
        {
          traceId: 'batch-trace',
          actorType: ActorTypes.SYSTEM,
          actorId: 'test',
          action: AuditActions.AGENT_CREATED,
          resource: 'agent:b',
          resourceType: ResourceTypes.AGENT,
          outcome: Outcomes.SUCCESS,
        },
      ]);

      expect(events).toHaveLength(2);
    });

    it('should return empty array for empty input', async () => {
      const events = await app.auditService.recordBatch([]);
      expect(events).toHaveLength(0);
    });
  });

  describe('query()', () => {
    beforeEach(async () => {
      // Seed some audit events
      await app.auditService.recordBatch([
        {
          traceId: 'trace-1',
          agentId: 'agent-a',
          actorType: ActorTypes.USER,
          actorId: 'user-1',
          action: AuditActions.AGENT_CREATED,
          resource: 'agent:agent-a',
          resourceType: ResourceTypes.AGENT,
          outcome: Outcomes.SUCCESS,
        },
        {
          traceId: 'trace-2',
          agentId: 'agent-a',
          actorType: ActorTypes.USER,
          actorId: 'user-1',
          action: AuditActions.TOKEN_ISSUED,
          resource: 'token:agent-a',
          resourceType: ResourceTypes.TOKEN,
          outcome: Outcomes.SUCCESS,
        },
        {
          traceId: 'trace-3',
          agentId: 'agent-b',
          actorType: ActorTypes.USER,
          actorId: 'user-2',
          action: AuditActions.AGENT_CREATED,
          resource: 'agent:agent-b',
          resourceType: ResourceTypes.AGENT,
          outcome: Outcomes.FAILURE,
        },
      ]);
    });

    it('should query events by agentId', async () => {
      const result = await app.auditService.query({
        agentId: 'agent-a',
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should query events by action', async () => {
      const result = await app.auditService.query({
        action: AuditActions.AGENT_CREATED,
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(2);
    });

    it('should query events by outcome', async () => {
      const result = await app.auditService.query({
        outcome: 'failure',
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.agentId).toBe('agent-b');
    });

    it('should support pagination', async () => {
      const result = await app.auditService.query({
        limit: 1,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(3);
    });
  });

  describe('getTrace()', () => {
    it('should return all events for a trace ID', async () => {
      await app.auditService.recordBatch([
        {
          traceId: 'correlated-trace',
          actorType: ActorTypes.SYSTEM,
          actorId: 'sys',
          action: AuditActions.AGENT_CREATED,
          resource: 'agent:x',
          resourceType: ResourceTypes.AGENT,
          outcome: Outcomes.SUCCESS,
        },
        {
          traceId: 'correlated-trace',
          actorType: ActorTypes.SYSTEM,
          actorId: 'sys',
          action: AuditActions.HTTP_REQUEST,
          resource: 'POST /agents',
          resourceType: ResourceTypes.HTTP,
          outcome: Outcomes.SUCCESS,
        },
      ]);

      const events = await app.auditService.getTrace('correlated-trace');
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.traceId === 'correlated-trace')).toBe(true);
    });

    it('should return empty array for unknown trace ID', async () => {
      const events = await app.auditService.getTrace('nonexistent-trace');
      expect(events).toHaveLength(0);
    });
  });

  describe('Audit events from agent operations', () => {
    it('should record audit event when agent is created', async () => {
      const agent = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: agent });

      const result = await app.auditService.query({
        action: AuditActions.AGENT_CREATED,
        agentId: agent.agentId,
        limit: 10,
        offset: 0,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const event = result.data.find(
        (e) => e.action === 'agent.created' && e.agentId === agent.agentId,
      );
      expect(event).toBeDefined();
      expect(event!.outcome).toBe('success');
    });

    it('should record audit event when agent is revoked', async () => {
      const agent = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: agent });
      await app.inject({ method: 'DELETE', url: `/agents/${agent.agentId}` });

      const result = await app.auditService.query({
        action: AuditActions.AGENT_REVOKED,
        agentId: agent.agentId,
        limit: 10,
        offset: 0,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should record audit event when token is issued', async () => {
      const agent = createTestAgent();
      await app.inject({ method: 'POST', url: '/agents', payload: agent });
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.agentId}/token`,
        payload: { ttlMinutes: 15 },
      });

      const result = await app.auditService.query({
        action: AuditActions.TOKEN_ISSUED,
        agentId: agent.agentId,
        limit: 10,
        offset: 0,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
