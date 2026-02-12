import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentService } from '../services/agent.service.js';
import { PermissionService } from '../services/permission.service.js';
import { ApprovalService } from '../services/approval.service.js';
import { StubIdentityProvider } from '../services/stub-identity-provider.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import type { PolicyContext } from '../services/policy-engine.js';
import {
  tokenExchangeParamSchema,
  tokenExchangeBodySchema,
  tokenExchangeResponseSchema,
  tokenExchangeApprovalRequiredSchema,
} from '../schemas/token-exchange.schema.js';

export async function tokenExchangeRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const agentService = new AgentService(app.db);
  const permissionService = new PermissionService(app.db);
  const approvalService = new ApprovalService(app.db);
  const idp = new StubIdentityProvider();

  // POST /agents/:agentId/token/exchange
  typedApp.route({
    method: 'POST',
    url: '/:agentId/token/exchange',
    schema: {
      params: tokenExchangeParamSchema,
      body: tokenExchangeBodySchema,
      response: {
        200: tokenExchangeResponseSchema,
        202: tokenExchangeApprovalRequiredSchema,
      },
    },
    handler: async (request, reply) => {
      const { agentId } = request.params;
      const { subject_token, scope, ttlMinutes, approvalId } = request.body;

      // 1. Verify subject_token
      const parentClaims = await idp.verifyToken(subject_token);

      // 2. Check if parent token is revoked
      const isRevoked = app.revocationSet.isRevoked(
        parentClaims.jti,
        parentClaims.agent_id,
        parentClaims.iat,
      );
      if (isRevoked) {
        throw new AppError(401, 'Unauthorized', 'Parent token has been revoked');
      }

      // 3. Confirm token's agent_id matches URL :agentId
      if (parentClaims.agent_id !== agentId) {
        throw new AppError(
          403,
          'Forbidden',
          `Token agent_id '${parentClaims.agent_id}' does not match URL agentId '${agentId}'`,
        );
      }

      // 3. Confirm agent is still active
      const agent = await agentService.getByAgentId(agentId);
      if (agent.lifecycleState !== 'active') {
        throw new AppError(
          403,
          'Forbidden',
          `Agent '${agentId}' is ${agent.lifecycleState}`,
        );
      }

      // 4. Validate scope against permission boundaries
      const validation = await permissionService.validateScope(agentId, scope);

      // 5. If any scope denied, return 403
      if (!validation.valid) {
        await app.auditService.record({
          traceId: request.traceId,
          actorType: ActorTypes.AGENT,
          actorId: agentId,
          action: AuditActions.TOKEN_EXCHANGE_DENIED,
          resource: `token:${agentId}`,
          resourceType: ResourceTypes.TOKEN,
          outcome: Outcomes.DENIED,
          agentId,
          outcomeReason: 'Scope exceeds permission boundaries',
          metadata: { requestedScope: scope, denied: validation.denied },
        });

        throw new AppError(403, 'Forbidden', 'Requested scope exceeds permission boundaries', {
          denied: validation.denied,
        });
      }

      // 6. NEW: Policy evaluation for each granted scope
      const policyContexts: PolicyContext[] = validation.granted.map((g) => ({
        agentId,
        agentType: agent.agentType,
        resource: g.resource,
        action: g.actions[0]!,
        actionTier: g.tier,
        timestamp: new Date(),
        ipAddress: request.ip,
      }));

      const decisions = await app.policyEngine.evaluateBatch(policyContexts);

      // Check for deny
      const denyDecision = decisions.find((d) => d.effect === 'deny');
      if (denyDecision) {
        await app.auditService.record({
          traceId: request.traceId,
          actorType: ActorTypes.AGENT,
          actorId: agentId,
          action: AuditActions.TOKEN_EXCHANGE_POLICY_DENIED,
          resource: `token:${agentId}`,
          resourceType: ResourceTypes.TOKEN,
          outcome: Outcomes.DENIED,
          agentId,
          outcomeReason: 'Policy evaluation denied',
          metadata: { reasons: denyDecision.reasons, matchedRules: denyDecision.matchedRules },
        });

        throw new AppError(403, 'Forbidden', 'Policy evaluation denied the request', {
          reasons: denyDecision.reasons,
          matchedRules: denyDecision.matchedRules,
        });
      }

      // Check for require_approval
      const approvalRequired = decisions.find((d) => d.effect === 'require_approval');
      if (approvalRequired && !approvalId) {
        // Create approval request
        const approval = await approvalService.create({
          agentId,
          requestedBy: parentClaims.owner_user_id,
          requestedScopes: scope,
          grantedPermissions: validation.granted,
          parentTokenJti: parentClaims.jti,
          ttlMinutes,
        });

        await app.auditService.record({
          traceId: request.traceId,
          actorType: ActorTypes.AGENT,
          actorId: agentId,
          action: AuditActions.TOKEN_EXCHANGE_APPROVAL_REQUIRED,
          resource: `approval:${approval.id}`,
          resourceType: ResourceTypes.APPROVAL,
          outcome: Outcomes.SUCCESS,
          agentId,
          metadata: { approvalId: approval.id, reasons: approvalRequired.reasons },
        });

        const requiredApprovals = decisions
          .filter((d) => d.effect === 'require_approval')
          .flatMap((d, i) => {
            const ctx = policyContexts[i]!;
            return d.reasons.map((reason) => ({
              resource: ctx.resource,
              action: ctx.action,
              reason,
            }));
          });

        return reply.status(202).send({
          approvalId: approval.id,
          status: 'pending_approval' as const,
          requiredApprovals,
          expiresAt: approval.expiresAt.toISOString(),
        });
      }

      // If approvalId provided, validate it
      if (approvalId) {
        await approvalService.validateForExchange(approvalId, agentId, scope);
      }

      // 7. Issue downscoped token
      const result = await idp.issueDownscopedToken(
        parentClaims,
        scope,
        validation.granted,
        ttlMinutes,
      );

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.AGENT,
        actorId: agentId,
        action: AuditActions.TOKEN_EXCHANGED,
        resource: `token:${agentId}`,
        resourceType: ResourceTypes.TOKEN,
        outcome: Outcomes.SUCCESS,
        agentId,
        metadata: { scope, ttlMinutes, parentJti: parentClaims.jti },
      });

      return reply.send(result);
    },
  });
}
