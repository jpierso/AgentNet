import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { agentIdentities, permissionBoundaries, consentGrants, auditEvents } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import type { AgentAccessSummary } from '../schemas/access-review.schema.js';

export class AccessReviewService {
  constructor(private db: Database) {}

  async getUserAccessSummary(userId: string): Promise<AgentAccessSummary[]> {
    // Find all agents owned or managed by this user
    const agents = await this.db
      .select()
      .from(agentIdentities)
      .where(
        sql`${agentIdentities.ownerUserId} = ${userId} OR ${agentIdentities.managerUserId} = ${userId}`,
      )
      .orderBy(agentIdentities.createdAt);

    const summaries: AgentAccessSummary[] = [];

    for (const agent of agents) {
      // Get permissions
      const permissions = await this.db
        .select()
        .from(permissionBoundaries)
        .where(eq(permissionBoundaries.agentId, agent.agentId));

      // Get last-used timestamps from audit_events per resource
      const lastUsedMap = new Map<string, string>();
      if (permissions.length > 0) {
        const resources = permissions.map((p) => p.resource);
        const lastUsedRows = await this.db
          .select({
            resource: auditEvents.resource,
            lastUsed: sql<string>`MAX(${auditEvents.timestamp})::text`,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.agentId, agent.agentId),
              inArray(auditEvents.resource, resources),
            ),
          )
          .groupBy(auditEvents.resource);

        for (const row of lastUsedRows) {
          lastUsedMap.set(row.resource, row.lastUsed);
        }
      }

      // Get consents for this agent from this user
      const consents = await this.db
        .select()
        .from(consentGrants)
        .where(
          and(
            eq(consentGrants.agentId, agent.agentId),
            eq(consentGrants.userId, userId),
          ),
        )
        .orderBy(desc(consentGrants.createdAt));

      summaries.push({
        agentId: agent.agentId,
        agentType: agent.agentType,
        lifecycleState: agent.lifecycleState,
        permissions: permissions.map((p) => ({
          id: p.id,
          resource: p.resource,
          allowedActions: p.allowedActions as string[],
          actionTier: p.actionTier,
          expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
          lastUsed: lastUsedMap.get(p.resource) ?? null,
        })),
        consents: consents.map((c) => ({
          id: c.id,
          status: c.status,
          scopes: c.scopes as string[],
          createdAt: c.createdAt.toISOString(),
        })),
      });
    }

    return summaries;
  }
}
