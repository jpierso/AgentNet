import { eq, and, sql } from 'drizzle-orm';
import { consentGrants, permissionBoundaries, agentIdentities, type ConsentGrant } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import type { CreateConsentInput } from '../schemas/consent.schema.js';

export class ConsentService {
  constructor(private db: Database) {}

  async grant(input: CreateConsentInput): Promise<ConsentGrant> {
    // Verify agent exists
    const [agent] = await this.db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, input.agentId))
      .limit(1);

    if (!agent) {
      throw new AppError(404, 'Not Found', `Agent '${input.agentId}' not found`);
    }

    // Snapshot current permissions for this agent
    const permissions = await this.db
      .select()
      .from(permissionBoundaries)
      .where(eq(permissionBoundaries.agentId, input.agentId));

    const permissionSnapshot = permissions.map((p) => ({
      id: p.id,
      resource: p.resource,
      allowedActions: p.allowedActions,
      actionTier: p.actionTier,
      conditions: p.conditions,
      expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    }));

    const [consent] = await this.db
      .insert(consentGrants)
      .values({
        agentId: input.agentId,
        userId: input.userId,
        permissionSnapshot,
        scopes: input.scopes,
      })
      .returning();

    return consent!;
  }

  async getById(consentId: string): Promise<ConsentGrant> {
    const [consent] = await this.db
      .select()
      .from(consentGrants)
      .where(eq(consentGrants.id, consentId))
      .limit(1);

    if (!consent) {
      throw new AppError(404, 'Not Found', `Consent '${consentId}' not found`);
    }

    return consent;
  }

  async revoke(consentId: string, revokedBy: string): Promise<ConsentGrant> {
    const consent = await this.getById(consentId);

    if (consent.status === 'revoked') {
      throw new AppError(409, 'Conflict', `Consent '${consentId}' is already revoked`);
    }

    const [updated] = await this.db
      .update(consentGrants)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy,
        updatedAt: new Date(),
      })
      .where(eq(consentGrants.id, consentId))
      .returning();

    return updated!;
  }

  async list(filters: {
    userId?: string;
    agentId?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ data: ConsentGrant[]; total: number }> {
    const conditions = [];

    if (filters.userId) {
      conditions.push(eq(consentGrants.userId, filters.userId));
    }
    if (filters.agentId) {
      conditions.push(eq(consentGrants.agentId, filters.agentId));
    }
    if (filters.status) {
      conditions.push(eq(consentGrants.status, filters.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(consentGrants)
        .where(whereClause)
        .limit(filters.limit)
        .offset(filters.offset)
        .orderBy(consentGrants.createdAt),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(consentGrants)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
    };
  }

  async getByAgentId(agentId: string): Promise<ConsentGrant[]> {
    return this.db
      .select()
      .from(consentGrants)
      .where(eq(consentGrants.agentId, agentId))
      .orderBy(consentGrants.createdAt);
  }

  /**
   * Revoke all active consents for a user (used during offboarding).
   * Returns the number of consents revoked.
   */
  async revokeAllForUser(userId: string, revokedBy: string): Promise<number> {
    const revoked = await this.db
      .update(consentGrants)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(consentGrants.userId, userId),
          eq(consentGrants.status, 'active'),
        ),
      )
      .returning();

    return revoked.length;
  }
}
