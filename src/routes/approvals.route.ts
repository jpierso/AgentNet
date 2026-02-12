import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApprovalService } from '../services/approval.service.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import type { ApprovalRequest } from '../db/schema.js';
import type { ApprovalResponse } from '../schemas/approval.schema.js';
import {
  approvalIdParamSchema,
  reviewApprovalSchema,
  approvalResponseSchema,
} from '../schemas/approval.schema.js';

function formatApproval(a: ApprovalRequest): ApprovalResponse {
  return {
    id: a.id,
    agentId: a.agentId,
    requestedBy: a.requestedBy,
    requestedScopes: a.requestedScopes as string[],
    grantedPermissions: a.grantedPermissions as ApprovalResponse['grantedPermissions'],
    parentTokenJti: a.parentTokenJti,
    ttlMinutes: a.ttlMinutes,
    status: a.status,
    reviewedBy: a.reviewedBy ?? null,
    reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
    reviewNote: a.reviewNote ?? null,
    expiresAt: a.expiresAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}

export async function approvalsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const approvalService = new ApprovalService(app.db);

  // GET /approvals/:approvalId — Check approval status
  typedApp.route({
    method: 'GET',
    url: '/:approvalId',
    schema: {
      params: approvalIdParamSchema,
      response: { 200: approvalResponseSchema },
    },
    handler: async (request, reply) => {
      const approval = await approvalService.getById(request.params.approvalId);
      return reply.send(formatApproval(approval));
    },
  });

  // POST /approvals/:approvalId/review — Approve or deny
  typedApp.route({
    method: 'POST',
    url: '/:approvalId/review',
    schema: {
      params: approvalIdParamSchema,
      body: reviewApprovalSchema,
      response: { 200: approvalResponseSchema },
    },
    handler: async (request, reply) => {
      const approval = await approvalService.review(
        request.params.approvalId,
        request.body,
      );

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: request.body.reviewedBy,
        action: AuditActions.APPROVAL_REVIEWED,
        resource: `approval:${approval.id}`,
        resourceType: ResourceTypes.APPROVAL,
        outcome: Outcomes.SUCCESS,
        agentId: approval.agentId,
        metadata: { decision: request.body.decision, note: request.body.note },
      });

      return reply.send(formatApproval(approval));
    },
  });
}
