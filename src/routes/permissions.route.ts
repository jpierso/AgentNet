import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PermissionService } from '../services/permission.service.js';
import { AuditActions, ActorTypes, Outcomes, ResourceTypes } from '../services/audit-events.js';
import type { PermissionBoundary } from '../db/schema.js';
import type { PermissionResponse } from '../schemas/permission.schema.js';
import {
  createPermissionSchema,
  updatePermissionSchema,
  permissionIdParamSchema,
  agentPermissionsParamSchema,
  permissionQuerySchema,
  permissionResponseSchema,
  permissionListResponseSchema,
} from '../schemas/permission.schema.js';

function formatPermission(p: PermissionBoundary): PermissionResponse {
  return {
    id: p.id,
    agentId: p.agentId,
    resource: p.resource,
    allowedActions: p.allowedActions as string[],
    actionTier: p.actionTier as PermissionResponse['actionTier'],
    conditions: (p.conditions as Record<string, unknown>) ?? null,
    grantedBy: p.grantedBy,
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function permissionsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const permissionService = new PermissionService(app.db);

  // POST /permissions — Create permission boundary
  typedApp.route({
    method: 'POST',
    url: '/',
    schema: {
      body: createPermissionSchema,
      response: { 201: permissionResponseSchema },
    },
    handler: async (request, reply) => {
      const permission = await permissionService.create(request.body);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: request.body.grantedBy,
        action: AuditActions.PERMISSION_CREATED,
        resource: `permission:${permission.id}`,
        resourceType: ResourceTypes.PERMISSION,
        outcome: Outcomes.SUCCESS,
        agentId: permission.agentId,
        metadata: { resource: permission.resource, actionTier: permission.actionTier },
      });

      return reply.status(201).send(formatPermission(permission));
    },
  });

  // GET /permissions/:permissionId
  typedApp.route({
    method: 'GET',
    url: '/:permissionId',
    schema: {
      params: permissionIdParamSchema,
      response: { 200: permissionResponseSchema },
    },
    handler: async (request, reply) => {
      const permission = await permissionService.getById(request.params.permissionId);
      return reply.send(formatPermission(permission));
    },
  });

  // GET /permissions — List with filters
  typedApp.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: permissionQuerySchema,
      response: { 200: permissionListResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await permissionService.list(request.query);
      return reply.send({
        data: result.data.map(formatPermission),
        total: result.total,
        limit: request.query.limit,
        offset: request.query.offset,
      });
    },
  });

  // PATCH /permissions/:permissionId
  typedApp.route({
    method: 'PATCH',
    url: '/:permissionId',
    schema: {
      params: permissionIdParamSchema,
      body: updatePermissionSchema,
      response: { 200: permissionResponseSchema },
    },
    handler: async (request, reply) => {
      const updated = await permissionService.update(
        request.params.permissionId,
        request.body,
      );

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: updated.grantedBy,
        action: AuditActions.PERMISSION_UPDATED,
        resource: `permission:${updated.id}`,
        resourceType: ResourceTypes.PERMISSION,
        outcome: Outcomes.SUCCESS,
        agentId: updated.agentId,
        metadata: { changes: request.body },
      });

      return reply.send(formatPermission(updated));
    },
  });

  // DELETE /permissions/:permissionId
  typedApp.route({
    method: 'DELETE',
    url: '/:permissionId',
    schema: {
      params: permissionIdParamSchema,
      response: { 200: permissionResponseSchema },
    },
    handler: async (request, reply) => {
      const deleted = await permissionService.delete(request.params.permissionId);

      await app.auditService.record({
        traceId: request.traceId,
        actorType: ActorTypes.USER,
        actorId: deleted.grantedBy,
        action: AuditActions.PERMISSION_DELETED,
        resource: `permission:${deleted.id}`,
        resourceType: ResourceTypes.PERMISSION,
        outcome: Outcomes.SUCCESS,
        agentId: deleted.agentId,
      });

      return reply.send(formatPermission(deleted));
    },
  });
}

/** Agent-scoped permissions route (mounted under /agents) */
export async function agentPermissionsRoute(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const permissionService = new PermissionService(app.db);

  // GET /agents/:agentId/permissions
  typedApp.route({
    method: 'GET',
    url: '/:agentId/permissions',
    schema: {
      params: agentPermissionsParamSchema,
      response: {
        200: permissionListResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const data = await permissionService.getByAgentId(request.params.agentId);
      return reply.send({
        data: data.map(formatPermission),
        total: data.length,
        limit: data.length,
        offset: 0,
      });
    },
  });
}
