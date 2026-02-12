import type { FastifyRequest } from 'fastify';
import { PermissionService } from '../services/permission.service.js';
import { AppError } from './error-handler.plugin.js';
import type { Database } from '../db/connection.js';

/**
 * Route-level permission validation helper.
 * Usage in a route handler:
 *   await checkPermissions(request.server.db, agentId, ['documents:read']);
 */
export async function checkPermissions(
  db: Database,
  agentId: string,
  requiredScopes: string[],
): Promise<void> {
  const permissionService = new PermissionService(db);
  const result = await permissionService.validateScope(agentId, requiredScopes);

  if (!result.valid) {
    throw new AppError(403, 'Forbidden', 'Insufficient permissions', {
      denied: result.denied,
    });
  }
}

/**
 * Extract agent claims from a bearer token on the request.
 * Returns undefined if no Authorization header is present.
 */
export function extractBearerToken(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return undefined;
  return auth.slice(7);
}
