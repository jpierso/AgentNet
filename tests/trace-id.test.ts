import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers.js';

describe('Trace ID Plugin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should generate a trace ID when none is provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const traceId = response.headers['x-trace-id'];
    expect(traceId).toBeDefined();
    expect(typeof traceId).toBe('string');
    // UUID v4 format
    expect(traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('should propagate an incoming X-Trace-Id header', async () => {
    const customTraceId = 'my-custom-trace-id-12345';
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-trace-id': customTraceId,
      },
    });

    expect(response.headers['x-trace-id']).toBe(customTraceId);
  });

  it('should generate a new trace ID if header is empty string', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-trace-id': '',
      },
    });

    const traceId = response.headers['x-trace-id'];
    expect(traceId).toBeDefined();
    expect(traceId).not.toBe('');
  });

  it('should return unique trace IDs for different requests', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/health' });
    const res2 = await app.inject({ method: 'GET', url: '/health' });

    expect(res1.headers['x-trace-id']).not.toBe(res2.headers['x-trace-id']);
  });
});
