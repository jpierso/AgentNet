import { eq, and, isNull } from 'drizzle-orm';
import { lifecycleEvents, agentSuspensionRecords, type LifecycleEvent } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import { AgentService } from './agent.service.js';
import { ConsentService } from './consent.service.js';
import { TokenRevocationService } from './token-revocation.service.js';
import { AttestationService } from './attestation.service.js';
import type { RevocationSet } from './revocation-set.js';
import type { LifecycleEventInput } from '../schemas/lifecycle-event.schema.js';

export interface LifecycleResult {
  event: LifecycleEvent;
  agentsAffected: number;
}

interface HandlerResult {
  agentsAffected: number;
  suspendedAgentIds?: string[];
}

export class LifecycleService {
  private agentService: AgentService;
  private consentService: ConsentService;
  private tokenRevocationService: TokenRevocationService;
  private attestationService: AttestationService;

  constructor(
    private db: Database,
    revocationSet: RevocationSet,
  ) {
    this.agentService = new AgentService(db);
    this.consentService = new ConsentService(db);
    this.tokenRevocationService = new TokenRevocationService(db, revocationSet);
    this.attestationService = new AttestationService(db);
  }

  async processEvent(input: LifecycleEventInput): Promise<LifecycleResult> {
    try {
      let result: HandlerResult;

      switch (input.eventType) {
        case 'user.suspended':
          result = await this.handleUserSuspended(input.userId);
          break;
        case 'user.reactivated':
          result = { agentsAffected: await this.handleUserReactivated(input.userId) };
          break;
        case 'user.departed':
          result = { agentsAffected: await this.handleUserDeparted(input.userId) };
          break;
        case 'user.role_changed':
          result = { agentsAffected: await this.handleUserRoleChanged(input.userId) };
          break;
      }

      // Log the event
      const [event] = await this.db
        .insert(lifecycleEvents)
        .values({
          eventType: input.eventType,
          userId: input.userId,
          payload: input.payload ?? null,
          status: 'processed',
          agentsAffected: result.agentsAffected,
        })
        .returning();

      // For user.suspended, record which agents were auto-suspended
      if (result.suspendedAgentIds && result.suspendedAgentIds.length > 0) {
        await this.recordSuspensions(result.suspendedAgentIds, event!.id);
      }

      return { event: event!, agentsAffected: result.agentsAffected };
    } catch (error) {
      // Log failed event
      await this.db
        .insert(lifecycleEvents)
        .values({
          eventType: input.eventType,
          userId: input.userId,
          payload: input.payload ?? null,
          status: 'failed',
          agentsAffected: 0,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        })
        .returning();

      throw error;
    }
  }

  private async handleUserSuspended(userId: string): Promise<HandlerResult> {
    // 1. Suspend all active agents owned by this user
    const agents = await this.agentService.suspendByOwner(userId);

    // 2. Blanket-revoke tokens for each affected agent
    for (const agent of agents) {
      await this.tokenRevocationService.revokeByAgent({
        agentId: agent.agentId,
        revokedBy: `lifecycle:user.suspended:${userId}`,
        reason: `Owner ${userId} suspended`,
      });
    }

    return {
      agentsAffected: agents.length,
      suspendedAgentIds: agents.map((a) => a.agentId),
    };
  }

  private async recordSuspensions(agentIds: string[], eventId: string): Promise<void> {
    for (const agentId of agentIds) {
      await this.db.insert(agentSuspensionRecords).values({
        agentId,
        previousState: 'active',
        suspendedByEvent: eventId,
      });
    }
  }

  private async handleUserReactivated(userId: string): Promise<number> {
    // Find agents that were auto-suspended (have a suspension record without reactivation)
    const suspensionRecords = await this.db
      .select()
      .from(agentSuspensionRecords)
      .where(isNull(agentSuspensionRecords.reactivatedAt));

    // Filter to agents owned by this user
    const { data: ownedAgents } = await this.agentService.list({
      ownerUserId: userId,
      lifecycleState: 'suspended',
      limit: 1000,
      offset: 0,
    });
    const ownedAgentIds = new Set(ownedAgents.map((a) => a.agentId));

    const toReactivate = suspensionRecords.filter((r) => ownedAgentIds.has(r.agentId));

    if (toReactivate.length === 0) return 0;

    // Restore agents to their previous state
    const agentIds = toReactivate.map((r) => r.agentId);
    const restored = await this.agentService.reactivateAgents(agentIds, 'active');

    // Mark suspension records as reactivated
    for (const record of toReactivate) {
      await this.db
        .update(agentSuspensionRecords)
        .set({ reactivatedAt: new Date() })
        .where(eq(agentSuspensionRecords.id, record.id));
    }

    return restored.length;
  }

  private async handleUserDeparted(userId: string): Promise<number> {
    // 1. Deprovision all agents owned by this user
    const agents = await this.agentService.deprovisionByOwner(userId);

    // 2. Revoke all tokens for affected agents
    for (const agent of agents) {
      await this.tokenRevocationService.revokeByAgent({
        agentId: agent.agentId,
        revokedBy: `lifecycle:user.departed:${userId}`,
        reason: `Owner ${userId} departed`,
      });
    }

    // 3. Revoke all consents for this user
    await this.consentService.revokeAllForUser(userId, `lifecycle:user.departed:${userId}`);

    return agents.length;
  }

  private async handleUserRoleChanged(userId: string): Promise<number> {
    // Find active agents owned by this user
    const { data: agents } = await this.agentService.list({
      ownerUserId: userId,
      lifecycleState: 'active',
      limit: 1000,
      offset: 0,
    });

    if (agents.length === 0) return 0;

    // Create an ad-hoc attestation campaign for review (7-day due date)
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await this.attestationService.createCampaign({
      name: `Role change review: ${userId}`,
      description: `Ad-hoc review triggered by role change for user ${userId}`,
      frequency: 'ad_hoc',
      scope: 'specific_agents',
      scopeFilter: {
        ownerUserIds: [userId],
      },
      createdBy: `lifecycle:user.role_changed:${userId}`,
      dueDate,
    });

    return agents.length;
  }
}
