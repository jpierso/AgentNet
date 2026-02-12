import { eq, and, sql, lte, inArray } from 'drizzle-orm';
import {
  attestationCampaigns,
  attestationItems,
  agentIdentities,
  permissionBoundaries,
  type AttestationCampaign,
  type AttestationItem,
} from '../db/schema.js';
import type { Database } from '../db/connection.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import type { CreateCampaignInput, ReviewItemInput } from '../schemas/attestation.schema.js';

const TIER_ORDER: Record<string, number> = { tier_0: 0, tier_1: 1, tier_2: 2, tier_3: 3 };

export class AttestationService {
  constructor(private db: Database) {}

  async createCampaign(input: CreateCampaignInput): Promise<{ campaign: AttestationCampaign; itemsGenerated: number }> {
    const [campaign] = await this.db
      .insert(attestationCampaigns)
      .values({
        name: input.name,
        description: input.description ?? null,
        frequency: input.frequency,
        scope: input.scope,
        scopeFilter: input.scopeFilter ?? null,
        createdBy: input.createdBy,
        dueDate: new Date(input.dueDate),
      })
      .returning();

    // Auto-generate attestation items
    const itemsGenerated = await this.generateItems(campaign!);

    return { campaign: campaign!, itemsGenerated };
  }

  private async generateItems(campaign: AttestationCampaign): Promise<number> {
    // Determine which agents to include based on scope
    let agentConditions;
    if (campaign.scope === 'specific_agents' && campaign.scopeFilter) {
      const filter = campaign.scopeFilter as { agentIds?: string[]; ownerUserIds?: string[] };
      if (filter.agentIds?.length) {
        agentConditions = inArray(agentIdentities.agentId, filter.agentIds);
      } else if (filter.ownerUserIds?.length) {
        agentConditions = inArray(agentIdentities.ownerUserId, filter.ownerUserIds);
      }
    }

    const agents = await this.db
      .select()
      .from(agentIdentities)
      .where(agentConditions ? and(eq(agentIdentities.lifecycleState, 'active'), agentConditions) : eq(agentIdentities.lifecycleState, 'active'));

    let itemCount = 0;

    for (const agent of agents) {
      // Get permissions for this agent
      let permissions = await this.db
        .select()
        .from(permissionBoundaries)
        .where(eq(permissionBoundaries.agentId, agent.agentId));

      // For sensitive_only scope, filter to tier_2+
      if (campaign.scope === 'sensitive_only') {
        permissions = permissions.filter((p) => (TIER_ORDER[p.actionTier] ?? 0) >= 2);
      }

      // For specific_agents with minTier filter
      if (campaign.scopeFilter) {
        const filter = campaign.scopeFilter as { minTier?: string };
        if (filter.minTier) {
          const minOrder = TIER_ORDER[filter.minTier] ?? 0;
          permissions = permissions.filter((p) => (TIER_ORDER[p.actionTier] ?? 0) >= minOrder);
        }
      }

      for (const perm of permissions) {
        const snapshot = {
          resource: perm.resource,
          allowedActions: perm.allowedActions,
          actionTier: perm.actionTier,
          conditions: perm.conditions,
        };

        // Owner always reviews
        await this.db.insert(attestationItems).values({
          campaignId: campaign.id,
          agentId: agent.agentId,
          permissionId: perm.id,
          reviewerUserId: agent.ownerUserId,
          reviewerRole: 'owner',
          permissionSnapshot: snapshot,
        });
        itemCount++;

        // tier_2+ requires dual attestation: manager also reviews
        if ((TIER_ORDER[perm.actionTier] ?? 0) >= 2) {
          await this.db.insert(attestationItems).values({
            campaignId: campaign.id,
            agentId: agent.agentId,
            permissionId: perm.id,
            reviewerUserId: agent.managerUserId,
            reviewerRole: 'manager',
            permissionSnapshot: snapshot,
          });
          itemCount++;
        }
      }
    }

    return itemCount;
  }

  async getCampaign(campaignId: string): Promise<AttestationCampaign> {
    const [campaign] = await this.db
      .select()
      .from(attestationCampaigns)
      .where(eq(attestationCampaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      throw new AppError(404, 'Not Found', `Campaign '${campaignId}' not found`);
    }

    return campaign;
  }

  async listCampaigns(filters: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ data: AttestationCampaign[]; total: number }> {
    const conditions = [];
    if (filters.status) {
      conditions.push(eq(attestationCampaigns.status, filters.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(attestationCampaigns)
        .where(whereClause)
        .limit(filters.limit)
        .offset(filters.offset)
        .orderBy(attestationCampaigns.createdAt),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(attestationCampaigns)
        .where(whereClause),
    ]);

    return { data, total: countResult[0]?.count ?? 0 };
  }

  async getCampaignProgress(campaignId: string): Promise<{
    campaignId: string;
    total: number;
    pending: number;
    attested: number;
    rejected: number;
    autoSuspended: number;
  }> {
    await this.getCampaign(campaignId); // ensure exists

    const rows = await this.db
      .select({
        status: attestationItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(attestationItems)
      .where(eq(attestationItems.campaignId, campaignId))
      .groupBy(attestationItems.status);

    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      counts[row.status] = row.count;
      total += row.count;
    }

    return {
      campaignId,
      total,
      pending: counts['pending'] ?? 0,
      attested: counts['attested'] ?? 0,
      rejected: counts['rejected'] ?? 0,
      autoSuspended: counts['auto_suspended'] ?? 0,
    };
  }

  async cancelCampaign(campaignId: string): Promise<AttestationCampaign> {
    const campaign = await this.getCampaign(campaignId);

    if (campaign.status !== 'active') {
      throw new AppError(409, 'Conflict', `Campaign '${campaignId}' is not active (status: ${campaign.status})`);
    }

    const [updated] = await this.db
      .update(attestationCampaigns)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(attestationCampaigns.id, campaignId))
      .returning();

    return updated!;
  }

  async processExpiredCampaign(campaignId: string): Promise<{ suspendedCount: number }> {
    const campaign = await this.getCampaign(campaignId);

    if (campaign.status !== 'active') {
      throw new AppError(409, 'Conflict', `Campaign '${campaignId}' is not active`);
    }

    if (new Date(campaign.dueDate) > new Date()) {
      throw new AppError(422, 'Validation Error', `Campaign '${campaignId}' has not yet expired (due: ${campaign.dueDate.toISOString()})`);
    }

    // Find all pending items
    const pendingItems = await this.db
      .select()
      .from(attestationItems)
      .where(
        and(
          eq(attestationItems.campaignId, campaignId),
          eq(attestationItems.status, 'pending'),
        ),
      );

    // Auto-suspend each pending item
    for (const item of pendingItems) {
      await this.db
        .update(attestationItems)
        .set({ status: 'auto_suspended', updatedAt: new Date() })
        .where(eq(attestationItems.id, item.id));

      // Expire the corresponding permission boundary
      await this.db
        .update(permissionBoundaries)
        .set({ expiresAt: new Date(), updatedAt: new Date() })
        .where(eq(permissionBoundaries.id, item.permissionId));
    }

    // Mark campaign as completed
    await this.db
      .update(attestationCampaigns)
      .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(attestationCampaigns.id, campaignId));

    return { suspendedCount: pendingItems.length };
  }

  // --- Attestation Items ---

  async getItem(itemId: string): Promise<AttestationItem> {
    const [item] = await this.db
      .select()
      .from(attestationItems)
      .where(eq(attestationItems.id, itemId))
      .limit(1);

    if (!item) {
      throw new AppError(404, 'Not Found', `Attestation item '${itemId}' not found`);
    }

    return item;
  }

  async listItems(filters: {
    campaignId?: string;
    reviewerUserId?: string;
    agentId?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ data: AttestationItem[]; total: number }> {
    const conditions = [];

    if (filters.campaignId) {
      conditions.push(eq(attestationItems.campaignId, filters.campaignId));
    }
    if (filters.reviewerUserId) {
      conditions.push(eq(attestationItems.reviewerUserId, filters.reviewerUserId));
    }
    if (filters.agentId) {
      conditions.push(eq(attestationItems.agentId, filters.agentId));
    }
    if (filters.status) {
      conditions.push(eq(attestationItems.status, filters.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(attestationItems)
        .where(whereClause)
        .limit(filters.limit)
        .offset(filters.offset)
        .orderBy(attestationItems.createdAt),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(attestationItems)
        .where(whereClause),
    ]);

    return { data, total: countResult[0]?.count ?? 0 };
  }

  async reviewItem(itemId: string, input: ReviewItemInput): Promise<AttestationItem> {
    const item = await this.getItem(itemId);

    if (item.status !== 'pending') {
      throw new AppError(409, 'Conflict', `Attestation item '${itemId}' is not pending (status: ${item.status})`);
    }

    if (item.reviewerUserId !== input.reviewerUserId) {
      throw new AppError(403, 'Forbidden', `User '${input.reviewerUserId}' is not the assigned reviewer`);
    }

    const newStatus = input.decision === 'confirm' ? 'attested' : 'rejected';

    const [updated] = await this.db
      .update(attestationItems)
      .set({
        status: newStatus,
        decision: input.decision,
        decisionNote: input.decisionNote ?? null,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(attestationItems.id, itemId))
      .returning();

    // If rejected, expire the permission
    if (input.decision === 'revoke') {
      await this.db
        .update(permissionBoundaries)
        .set({ expiresAt: new Date(), updatedAt: new Date() })
        .where(eq(permissionBoundaries.id, item.permissionId));
    }

    return updated!;
  }

  async getItemsByAgentId(agentId: string): Promise<AttestationItem[]> {
    return this.db
      .select()
      .from(attestationItems)
      .where(eq(attestationItems.agentId, agentId))
      .orderBy(attestationItems.createdAt);
  }
}
