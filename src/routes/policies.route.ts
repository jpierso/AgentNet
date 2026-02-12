import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { policyRules } from '../db/schema.js';
import type { PolicyRule } from '../db/schema.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import type { PolicyResponse } from '../schemas/policy.schema.js';
import {
  createPolicySchema,
  updatePolicySchema,
  policyIdParamSchema,
  policyQuerySchema,
  evaluatePolicySchema,
  policyResponseSchema,
  policyListResponseSchema,
  policyDecisionResponseSchema,
} from '../schemas/policy.schema.js';

function formatPolicy(p: PolicyRule): PolicyResponse {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    enabled: p.enabled,
    priority: p.priority,
    resourcePattern: p.resourcePattern,
    actionPattern: p.actionPattern,
    agentTypePattern: p.agentTypePattern ?? null,
    tier: p.tier ?? null,
    conditions: (p.conditions as Record<string, unknown>) ?? null,
    effect: p.effect,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function policiesRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // POST /policies — Create policy rule
  typedApp.route({
    method: 'POST',
    url: '/',
    schema: {
      body: createPolicySchema,
      response: { 201: policyResponseSchema },
    },
    handler: async (request, reply) => {
      const [policy] = await app.db
        .insert(policyRules)
        .values({
          name: request.body.name,
          description: request.body.description ?? null,
          enabled: request.body.enabled,
          priority: request.body.priority,
          resourcePattern: request.body.resourcePattern,
          actionPattern: request.body.actionPattern,
          agentTypePattern: request.body.agentTypePattern ?? null,
          tier: request.body.tier ?? null,
          conditions: request.body.conditions ?? null,
          effect: request.body.effect,
        })
        .returning();

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.SYSTEM,
        actorId: 'system',
        action: AuditActions.POLICY_CREATED,
        resource: `policy:${policy!.id}`,
        resourceType: ResourceTypes.POLICY,
        outcome: Outcomes.SUCCESS,
        metadata: { name: policy!.name, effect: policy!.effect },
      });

      return reply.status(201).send(formatPolicy(policy!));
    },
  });

  // GET /policies — List policy rules
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: policyQuerySchema,
      response: { 200: policyListResponseSchema },
    },
    handler: async (request, reply) => {
      const conditions = [];

      if (request.query.enabled !== undefined) {
        conditions.push(eq(policyRules.enabled, request.query.enabled));
      }
      if (request.query.resourcePattern) {
        conditions.push(eq(policyRules.resourcePattern, request.query.resourcePattern));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [data, countResult] = await Promise.all([
        app.db
          .select()
          .from(policyRules)
          .where(whereClause)
          .limit(request.query.limit)
          .offset(request.query.offset)
          .orderBy(desc(policyRules.priority)),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(policyRules)
          .where(whereClause),
      ]);

      return reply.send({
        data: data.map(formatPolicy),
        total: countResult[0]?.count ?? 0,
        limit: request.query.limit,
        offset: request.query.offset,
      });
    },
  });

  // GET /policies/:policyId
  typedApp.route({
    method: 'GET',
    url: '/:policyId',
    schema: {
      params: policyIdParamSchema,
      response: { 200: policyResponseSchema },
    },
    handler: async (request, reply) => {
      const [policy] = await app.db
        .select()
        .from(policyRules)
        .where(eq(policyRules.id, request.params.policyId))
        .limit(1);

      if (!policy) {
        throw new AppError(404, 'Not Found', `Policy '${request.params.policyId}' not found`);
      }

      return reply.send(formatPolicy(policy));
    },
  });

  // PATCH /policies/:policyId
  typedApp.route({
    method: 'PATCH',
    url: '/:policyId',
    schema: {
      params: policyIdParamSchema,
      body: updatePolicySchema,
      response: { 200: policyResponseSchema },
    },
    handler: async (request, reply) => {
      const [existing] = await app.db
        .select()
        .from(policyRules)
        .where(eq(policyRules.id, request.params.policyId))
        .limit(1);

      if (!existing) {
        throw new AppError(404, 'Not Found', `Policy '${request.params.policyId}' not found`);
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      const body = request.body;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.enabled !== undefined) updateData.enabled = body.enabled;
      if (body.priority !== undefined) updateData.priority = body.priority;
      if (body.resourcePattern !== undefined) updateData.resourcePattern = body.resourcePattern;
      if (body.actionPattern !== undefined) updateData.actionPattern = body.actionPattern;
      if (body.agentTypePattern !== undefined) updateData.agentTypePattern = body.agentTypePattern;
      if (body.tier !== undefined) updateData.tier = body.tier;
      if (body.conditions !== undefined) updateData.conditions = body.conditions;
      if (body.effect !== undefined) updateData.effect = body.effect;

      const [updated] = await app.db
        .update(policyRules)
        .set(updateData)
        .where(eq(policyRules.id, request.params.policyId))
        .returning();

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.SYSTEM,
        actorId: 'system',
        action: AuditActions.POLICY_UPDATED,
        resource: `policy:${updated!.id}`,
        resourceType: ResourceTypes.POLICY,
        outcome: Outcomes.SUCCESS,
        metadata: { changes: body },
      });

      return reply.send(formatPolicy(updated!));
    },
  });

  // DELETE /policies/:policyId
  typedApp.route({
    method: 'DELETE',
    url: '/:policyId',
    schema: {
      params: policyIdParamSchema,
      response: { 200: policyResponseSchema },
    },
    handler: async (request, reply) => {
      const [existing] = await app.db
        .select()
        .from(policyRules)
        .where(eq(policyRules.id, request.params.policyId))
        .limit(1);

      if (!existing) {
        throw new AppError(404, 'Not Found', `Policy '${request.params.policyId}' not found`);
      }

      await app.db.delete(policyRules).where(eq(policyRules.id, request.params.policyId));

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.SYSTEM,
        actorId: 'system',
        action: AuditActions.POLICY_DELETED,
        resource: `policy:${existing.id}`,
        resourceType: ResourceTypes.POLICY,
        outcome: Outcomes.SUCCESS,
        metadata: { name: existing.name },
      });

      return reply.send(formatPolicy(existing));
    },
  });

  // POST /policies/evaluate — Dry-run policy evaluation
  typedApp.route({
    method: 'POST',
    url: '/evaluate',
    schema: {
      body: evaluatePolicySchema,
      response: { 200: policyDecisionResponseSchema },
    },
    handler: async (request, reply) => {
      const decision = await app.policyEngine.evaluate({
        agentId: request.body.agentId,
        agentType: request.body.agentType,
        resource: request.body.resource,
        action: request.body.action,
        actionTier: request.body.actionTier,
        timestamp: new Date(),
        ipAddress: request.body.ipAddress,
      });

      return reply.send(decision);
    },
  });
}
