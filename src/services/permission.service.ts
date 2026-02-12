import { eq, and, sql } from 'drizzle-orm';
import { permissionBoundaries, agentIdentities, type PermissionBoundary } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import type { CreatePermissionInput, UpdatePermissionInput } from '../schemas/permission.schema.js';

const TIER_ORDER = { tier_0: 0, tier_1: 1, tier_2: 2, tier_3: 3 } as const;

export interface ScopeValidationResult {
  valid: boolean;
  granted: Array<{ resource: string; actions: string[]; tier: string }>;
  denied: Array<{ scope: string; reason: string }>;
}

export class PermissionService {
  constructor(private db: Database) {}

  async create(input: CreatePermissionInput): Promise<PermissionBoundary> {
    // Verify agent exists
    const [agent] = await this.db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, input.agentId))
      .limit(1);

    if (!agent) {
      throw new AppError(404, 'Not Found', `Agent '${input.agentId}' not found`);
    }

    const [permission] = await this.db
      .insert(permissionBoundaries)
      .values({
        agentId: input.agentId,
        resource: input.resource,
        allowedActions: input.allowedActions,
        actionTier: input.actionTier,
        conditions: input.conditions ?? null,
        grantedBy: input.grantedBy,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning();

    return permission!;
  }

  async getById(permissionId: string): Promise<PermissionBoundary> {
    const [permission] = await this.db
      .select()
      .from(permissionBoundaries)
      .where(eq(permissionBoundaries.id, permissionId))
      .limit(1);

    if (!permission) {
      throw new AppError(404, 'Not Found', `Permission '${permissionId}' not found`);
    }

    return permission;
  }

  async update(permissionId: string, input: UpdatePermissionInput): Promise<PermissionBoundary> {
    const existing = await this.getById(permissionId);

    // No tier escalation: cannot raise tier above existing
    if (input.actionTier) {
      const existingOrder = TIER_ORDER[existing.actionTier as keyof typeof TIER_ORDER];
      const newOrder = TIER_ORDER[input.actionTier as keyof typeof TIER_ORDER];
      if (newOrder > existingOrder) {
        throw new AppError(
          403,
          'Forbidden',
          `Cannot escalate tier from ${existing.actionTier} to ${input.actionTier}`,
        );
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.allowedActions !== undefined) updateData.allowedActions = input.allowedActions;
    if (input.actionTier !== undefined) updateData.actionTier = input.actionTier;
    if (input.conditions !== undefined) updateData.conditions = input.conditions;
    if (input.expiresAt !== undefined) {
      updateData.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    }

    const [updated] = await this.db
      .update(permissionBoundaries)
      .set(updateData)
      .where(eq(permissionBoundaries.id, permissionId))
      .returning();

    return updated!;
  }

  async delete(permissionId: string): Promise<PermissionBoundary> {
    const existing = await this.getById(permissionId);

    await this.db
      .delete(permissionBoundaries)
      .where(eq(permissionBoundaries.id, permissionId));

    return existing;
  }

  async getByAgentId(agentId: string): Promise<PermissionBoundary[]> {
    return this.db
      .select()
      .from(permissionBoundaries)
      .where(eq(permissionBoundaries.agentId, agentId))
      .orderBy(permissionBoundaries.resource);
  }

  async list(filters: {
    agentId?: string;
    resource?: string;
    actionTier?: string;
    limit: number;
    offset: number;
  }): Promise<{ data: PermissionBoundary[]; total: number }> {
    const conditions = [];

    if (filters.agentId) {
      conditions.push(eq(permissionBoundaries.agentId, filters.agentId));
    }
    if (filters.resource) {
      conditions.push(eq(permissionBoundaries.resource, filters.resource));
    }
    if (filters.actionTier) {
      conditions.push(eq(permissionBoundaries.actionTier, filters.actionTier));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(permissionBoundaries)
        .where(whereClause)
        .limit(filters.limit)
        .offset(filters.offset)
        .orderBy(permissionBoundaries.createdAt),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(permissionBoundaries)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
    };
  }

  /**
   * Validate that a set of scopes (e.g. ["documents:read", "billing:invoices:list"])
   * are within the agent's permission boundaries.
   */
  async validateScope(agentId: string, scopes: string[]): Promise<ScopeValidationResult> {
    const permissions = await this.getByAgentId(agentId);
    const now = new Date();

    // Filter out expired permissions
    const activePermissions = permissions.filter(
      (p) => !p.expiresAt || p.expiresAt > now,
    );

    const granted: ScopeValidationResult['granted'] = [];
    const denied: ScopeValidationResult['denied'] = [];

    for (const scope of scopes) {
      const lastColon = scope.lastIndexOf(':');
      if (lastColon === -1) {
        denied.push({ scope, reason: 'Invalid scope format (expected "resource:action")' });
        continue;
      }

      const resource = scope.substring(0, lastColon);
      const action = scope.substring(lastColon + 1);

      const matching = activePermissions.find(
        (p) => p.resource === resource && (p.allowedActions as string[]).includes(action),
      );

      if (matching) {
        granted.push({
          resource: matching.resource,
          actions: [action],
          tier: matching.actionTier,
        });
      } else {
        denied.push({ scope, reason: 'No matching permission boundary' });
      }
    }

    return {
      valid: denied.length === 0,
      granted,
      denied,
    };
  }
}
