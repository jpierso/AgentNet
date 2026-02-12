import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanDatabase, createTestAgent } from './helpers.js';
import { PgPolicyEngine } from '../src/services/pg-policy-engine.js';
import { policyRules } from '../src/db/schema.js';
import type { PolicyContext } from '../src/services/policy-engine.js';

describe('PgPolicyEngine', () => {
  let app: FastifyInstance;
  let engine: PgPolicyEngine;
  let testAgentId: string;

  const baseContext: PolicyContext = {
    agentId: 'test-agent',
    agentType: 'code-assistant',
    resource: 'documents',
    action: 'read',
    actionTier: 'tier_0',
    timestamp: new Date('2025-01-15T12:00:00Z'), // Wednesday noon UTC
  };

  beforeAll(async () => {
    app = await buildTestApp();
    engine = new PgPolicyEngine(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    const agent = createTestAgent({ agentId: 'test-agent' });
    testAgentId = agent.agentId;
    await app.inject({ method: 'POST', url: '/agents', payload: agent });
  });

  // --- Tier enforcement ---

  it('should always deny tier_3 operations', async () => {
    const decision = await engine.evaluate({ ...baseContext, actionTier: 'tier_3' });
    expect(decision.effect).toBe('deny');
    expect(decision.reasons[0]).toContain('Tier 3');
  });

  it('should require approval for tier_2 operations', async () => {
    const decision = await engine.evaluate({ ...baseContext, actionTier: 'tier_2' });
    expect(decision.effect).toBe('require_approval');
    expect(decision.reasons[0]).toContain('Tier 2');
  });

  it('should allow tier_0 operations by default', async () => {
    const decision = await engine.evaluate({ ...baseContext, actionTier: 'tier_0' });
    expect(decision.effect).toBe('allow');
  });

  it('should allow tier_1 operations by default', async () => {
    const decision = await engine.evaluate({ ...baseContext, actionTier: 'tier_1' });
    expect(decision.effect).toBe('allow');
  });

  // --- Policy rule matching ---

  it('should deny when a matching deny rule exists', async () => {
    await app.db.insert(policyRules).values({
      name: 'block-billing-delete',
      resourcePattern: 'billing',
      actionPattern: 'delete',
      effect: 'deny',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'billing',
      action: 'delete',
    });

    expect(decision.effect).toBe('deny');
    expect(decision.matchedRules).toHaveLength(1);
    expect(decision.matchedRules[0]!.name).toBe('block-billing-delete');
  });

  it('should match wildcard resource pattern', async () => {
    await app.db.insert(policyRules).values({
      name: 'deny-all-delete',
      resourcePattern: '*',
      actionPattern: 'delete',
      effect: 'deny',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'any-resource',
      action: 'delete',
    });

    expect(decision.effect).toBe('deny');
  });

  it('should match wildcard action pattern', async () => {
    await app.db.insert(policyRules).values({
      name: 'deny-all-billing',
      resourcePattern: 'billing',
      actionPattern: '*',
      effect: 'deny',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'billing',
      action: 'read',
    });

    expect(decision.effect).toBe('deny');
  });

  it('should match glob patterns with prefix', async () => {
    await app.db.insert(policyRules).values({
      name: 'deny-billing-prefix',
      resourcePattern: 'billing:*',
      actionPattern: '*',
      effect: 'deny',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'billing:invoices',
      action: 'read',
    });

    expect(decision.effect).toBe('deny');
  });

  it('should not match non-matching patterns', async () => {
    await app.db.insert(policyRules).values({
      name: 'deny-billing',
      resourcePattern: 'billing',
      actionPattern: 'delete',
      effect: 'deny',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'documents',
      action: 'read',
    });

    expect(decision.effect).toBe('allow');
  });

  it('should respect priority (higher priority first)', async () => {
    await app.db.insert(policyRules).values([
      {
        name: 'low-priority-allow',
        resourcePattern: 'documents',
        actionPattern: 'delete',
        effect: 'allow',
        priority: 1,
      },
      {
        name: 'high-priority-deny',
        resourcePattern: 'documents',
        actionPattern: 'delete',
        effect: 'deny',
        priority: 100,
      },
    ]);

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'documents',
      action: 'delete',
    });

    expect(decision.effect).toBe('deny');
    expect(decision.matchedRules[0]!.name).toBe('high-priority-deny');
  });

  it('should skip disabled rules', async () => {
    await app.db.insert(policyRules).values({
      name: 'disabled-deny',
      resourcePattern: '*',
      actionPattern: '*',
      effect: 'deny',
      priority: 100,
      enabled: false,
    });

    const decision = await engine.evaluate(baseContext);
    expect(decision.effect).toBe('allow');
  });

  // --- Agent type matching ---

  it('should match agent type pattern', async () => {
    await app.db.insert(policyRules).values({
      name: 'deny-code-assistant-billing',
      resourcePattern: 'billing',
      actionPattern: '*',
      agentTypePattern: 'code-assistant',
      effect: 'deny',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      agentType: 'code-assistant',
      resource: 'billing',
    });

    expect(decision.effect).toBe('deny');
  });

  it('should not match wrong agent type', async () => {
    await app.db.insert(policyRules).values({
      name: 'deny-data-agent-billing',
      resourcePattern: 'billing',
      actionPattern: '*',
      agentTypePattern: 'data-agent',
      effect: 'deny',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      agentType: 'code-assistant',
      resource: 'billing',
    });

    expect(decision.effect).toBe('allow');
  });

  // --- Tier-specific rules ---

  it('should match tier-specific rules', async () => {
    await app.db.insert(policyRules).values({
      name: 'require-approval-tier1-billing',
      resourcePattern: 'billing',
      actionPattern: '*',
      tier: 'tier_1',
      effect: 'require_approval',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'billing',
      actionTier: 'tier_1',
    });

    expect(decision.effect).toBe('require_approval');
  });

  it('should not match tier-specific rule for different tier', async () => {
    await app.db.insert(policyRules).values({
      name: 'require-approval-tier1-billing',
      resourcePattern: 'billing',
      actionPattern: '*',
      tier: 'tier_1',
      effect: 'require_approval',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'billing',
      actionTier: 'tier_0',
    });

    expect(decision.effect).toBe('allow');
  });

  // --- Conditions on rules ---

  it('should deny when rule conditions fail (after-hours)', async () => {
    await app.db.insert(policyRules).values({
      name: 'business-hours-only',
      resourcePattern: '*',
      actionPattern: '*',
      effect: 'deny',
      priority: 10,
      conditions: { allowed_hours: { start: '09:00', end: '17:00' } },
    });

    // Rule says deny, but conditions say allowed_hours 09-17.
    // If we are WITHIN hours, conditions pass → rule matches → deny
    const withinHours = await engine.evaluate({
      ...baseContext,
      timestamp: new Date('2025-01-15T12:00:00Z'),
    });
    expect(withinHours.effect).toBe('deny');

    // If we are OUTSIDE hours, conditions fail → rule doesn't match → default allow
    const outsideHours = await engine.evaluate({
      ...baseContext,
      timestamp: new Date('2025-01-15T20:00:00Z'),
    });
    expect(outsideHours.effect).toBe('allow');
  });

  it('should deny based on IP conditions in rules', async () => {
    await app.db.insert(policyRules).values({
      name: 'allow-internal-only',
      resourcePattern: '*',
      actionPattern: '*',
      effect: 'deny',
      priority: 10,
      conditions: { allowed_ips: ['10.0.0.0/8'] },
    });

    // Internal IP → conditions pass → rule matches → deny
    const internal = await engine.evaluate({
      ...baseContext,
      ipAddress: '10.0.0.5',
    });
    expect(internal.effect).toBe('deny');

    // External IP → conditions fail → rule doesn't match → allow
    const external = await engine.evaluate({
      ...baseContext,
      ipAddress: '192.168.1.1',
    });
    expect(external.effect).toBe('allow');
  });

  // --- Permission boundary conditions ---

  it('should deny when permission boundary conditions fail', async () => {
    const decision = await engine.evaluate({
      ...baseContext,
      conditions: {
        allowed_hours: { start: '09:00', end: '17:00' },
      },
      timestamp: new Date('2025-01-15T20:00:00Z'),
    });

    expect(decision.effect).toBe('deny');
    expect(decision.reasons[0]).toContain('outside allowed hours');
  });

  it('should allow when permission boundary conditions pass', async () => {
    const decision = await engine.evaluate({
      ...baseContext,
      conditions: {
        allowed_hours: { start: '09:00', end: '17:00' },
      },
      timestamp: new Date('2025-01-15T12:00:00Z'),
    });

    expect(decision.effect).toBe('allow');
  });

  // --- Batch evaluation ---

  it('should evaluate batch of contexts', async () => {
    const decisions = await engine.evaluateBatch([
      { ...baseContext, actionTier: 'tier_0' },
      { ...baseContext, actionTier: 'tier_2' },
      { ...baseContext, actionTier: 'tier_3' },
    ]);

    expect(decisions).toHaveLength(3);
    expect(decisions[0]!.effect).toBe('allow');
    expect(decisions[1]!.effect).toBe('require_approval');
    expect(decisions[2]!.effect).toBe('deny');
  });

  // --- require_approval effect from rules ---

  it('should return require_approval from rule effect', async () => {
    await app.db.insert(policyRules).values({
      name: 'approval-for-sensitive',
      resourcePattern: 'sensitive-data',
      actionPattern: '*',
      effect: 'require_approval',
      priority: 10,
    });

    const decision = await engine.evaluate({
      ...baseContext,
      resource: 'sensitive-data',
    });

    expect(decision.effect).toBe('require_approval');
  });
});
