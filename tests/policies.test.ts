import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';

describe('Policy CRUD', () => {
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

  const validPolicy = {
    name: 'test-policy',
    description: 'A test policy',
    resourcePattern: 'documents',
    actionPattern: 'read',
    effect: 'deny' as const,
    priority: 10,
  };

  // --- CREATE ---

  it('should create a policy rule', async () => {
    const res = await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('test-policy');
    expect(body.effect).toBe('deny');
    expect(body.enabled).toBe(true);
    expect(body.id).toBeDefined();
  });

  it('should reject duplicate policy name', async () => {
    await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    const res = await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    expect(res.statusCode).toBe(500); // unique constraint violation
  });

  it('should create policy with conditions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/policies',
      payload: {
        ...validPolicy,
        name: 'business-hours',
        conditions: { allowed_hours: { start: '09:00', end: '17:00' } },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().conditions).toEqual({ allowed_hours: { start: '09:00', end: '17:00' } });
  });

  // --- GET ---

  it('should get a policy by ID', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    const id = createRes.json().id;

    const res = await app.inject({ method: 'GET', url: `/policies/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('test-policy');
  });

  it('should return 404 for non-existent policy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/policies/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  // --- LIST ---

  it('should list policies', async () => {
    await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    await app.inject({
      method: 'POST',
      url: '/policies',
      payload: { ...validPolicy, name: 'second-policy', priority: 20 },
    });

    const res = await app.inject({ method: 'GET', url: '/policies' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    // Higher priority first
    expect(body.data[0].name).toBe('second-policy');
  });

  it('should filter policies by enabled', async () => {
    await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    await app.inject({
      method: 'POST',
      url: '/policies',
      payload: { ...validPolicy, name: 'disabled-policy', enabled: false },
    });

    const res = await app.inject({ method: 'GET', url: '/policies?enabled=true' });
    expect(res.json().total).toBe(1);
    expect(res.json().data[0].name).toBe('test-policy');
  });

  // --- UPDATE ---

  it('should update a policy', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    const id = createRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/policies/${id}`,
      payload: { enabled: false, priority: 50 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect(res.json().priority).toBe(50);
  });

  // --- DELETE ---

  it('should delete a policy', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/policies', payload: validPolicy });
    const id = createRes.json().id;

    const res = await app.inject({ method: 'DELETE', url: `/policies/${id}` });
    expect(res.statusCode).toBe(200);

    const getRes = await app.inject({ method: 'GET', url: `/policies/${id}` });
    expect(getRes.statusCode).toBe(404);
  });

  // --- EVALUATE ---

  it('should evaluate policy context (dry-run)', async () => {
    // Create a deny rule for billing:delete
    await app.inject({
      method: 'POST',
      url: '/policies',
      payload: {
        name: 'block-billing-delete',
        resourcePattern: 'billing',
        actionPattern: 'delete',
        effect: 'deny',
        priority: 10,
      },
    });

    // Create a test agent for the context
    const agent = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: agent });

    const res = await app.inject({
      method: 'POST',
      url: '/policies/evaluate',
      payload: {
        agentId: agent.agentId,
        agentType: 'code-assistant',
        resource: 'billing',
        action: 'delete',
        actionTier: 'tier_0',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().effect).toBe('deny');
    expect(res.json().matchedRules).toHaveLength(1);
  });

  it('should return allow when no rules match (dry-run)', async () => {
    const agent = createTestAgent();
    await app.inject({ method: 'POST', url: '/agents', payload: agent });

    const res = await app.inject({
      method: 'POST',
      url: '/policies/evaluate',
      payload: {
        agentId: agent.agentId,
        agentType: 'code-assistant',
        resource: 'documents',
        action: 'read',
        actionTier: 'tier_0',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().effect).toBe('allow');
  });
});
