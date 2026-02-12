import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';

describe('Audit Hook (HTTP auto-capture)', () => {
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

  it('should capture HTTP request audit events for non-health endpoints', async () => {
    const agent = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: agent });

    // Wait briefly for async audit hook
    await new Promise((r) => setTimeout(r, 50));

    const result = await app.auditService.query({
      action: 'http.request',
      limit: 50,
      offset: 0,
    });

    // Should have captured the POST /agents request
    const postEvent = result.data.find(
      (e) => e.requestMethod === 'POST' && e.requestPath === '/agents',
    );
    expect(postEvent).toBeDefined();
    expect(postEvent!.statusCode).toBe(201);
    expect(postEvent!.outcome).toBe('success');
    expect(postEvent!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should not capture health check requests', async () => {
    await app.inject({ method: 'GET', url: '/health' });

    await new Promise((r) => setTimeout(r, 50));

    const result = await app.auditService.query({
      action: 'http.request',
      limit: 50,
      offset: 0,
    });

    const healthEvent = result.data.find(
      (e) => e.requestPath === '/health',
    );
    expect(healthEvent).toBeUndefined();
  });

  it('should capture failed request with correct outcome', async () => {
    await app.inject({
      method: 'GET',
      url: '/agents/nonexistent-agent',
    });

    await new Promise((r) => setTimeout(r, 50));

    const result = await app.auditService.query({
      action: 'http.request',
      limit: 50,
      offset: 0,
    });

    const failEvent = result.data.find(
      (e) => e.requestPath === '/agents/nonexistent-agent' && e.statusCode === 404,
    );
    expect(failEvent).toBeDefined();
    expect(failEvent!.outcome).toBe('failure');
  });

  it('should include trace ID in audit events', async () => {
    const customTraceId = 'audit-hook-trace-123';
    const agent = createTestAgent();
    await app.inject({
      method: 'POST',
      url: '/agents',
      payload: agent,
      headers: { 'x-trace-id': customTraceId },
    });

    await new Promise((r) => setTimeout(r, 50));

    const result = await app.auditService.query({
      action: 'http.request',
      limit: 50,
      offset: 0,
    });

    const event = result.data.find((e) => e.traceId === customTraceId);
    expect(event).toBeDefined();
  });

  it('should capture 403 as denied outcome', async () => {
    // Create agent, revoke it, then try to issue token (will get 403)
    const agent = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: agent });
    await app.inject({
      method: 'PATCH',
      url: `/agents/${agent.agentId}`,
      payload: { lifecycleState: 'revoked' },
    });

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.agentId}/token`,
      payload: { ttlMinutes: 15 },
    });

    await new Promise((r) => setTimeout(r, 50));

    const result = await app.auditService.query({
      action: 'http.request',
      limit: 50,
      offset: 0,
    });

    const deniedEvent = result.data.find(
      (e) =>
        e.requestPath === `/agents/${agent.agentId}/token` &&
        e.statusCode === 403,
    );
    expect(deniedEvent).toBeDefined();
    expect(deniedEvent!.outcome).toBe('denied');
  });
});
