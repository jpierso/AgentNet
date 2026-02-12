import { eq, and, sql } from 'drizzle-orm';
import { agentIdentities, type AgentIdentity } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import type { CreateAgentInput, UpdateAgentInput } from '../schemas/agent.schema.js';

export class AgentService {
  constructor(private db: Database) {}

  async create(input: CreateAgentInput): Promise<AgentIdentity> {
    const existing = await this.db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, input.agentId))
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(409, 'Conflict', `Agent with agent_id '${input.agentId}' already exists`);
    }

    const [agent] = await this.db
      .insert(agentIdentities)
      .values({
        agentId: input.agentId,
        ownerUserId: input.ownerUserId,
        managerUserId: input.managerUserId,
        agentType: input.agentType,
        modelVersion: input.modelVersion ?? null,
        purpose: input.purpose ?? null,
        oktaClientId: input.oktaClientId ?? null,
      })
      .returning();

    return agent!;
  }

  async getByAgentId(agentId: string): Promise<AgentIdentity> {
    const [agent] = await this.db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, agentId))
      .limit(1);

    if (!agent) {
      throw new AppError(404, 'Not Found', `Agent '${agentId}' not found`);
    }

    return agent;
  }

  async update(agentId: string, input: UpdateAgentInput): Promise<AgentIdentity> {
    await this.getByAgentId(agentId);

    const [updated] = await this.db
      .update(agentIdentities)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(agentIdentities.agentId, agentId))
      .returning();

    return updated!;
  }

  async softDelete(agentId: string): Promise<AgentIdentity> {
    const agent = await this.getByAgentId(agentId);

    if (agent.lifecycleState === 'revoked') {
      throw new AppError(409, 'Conflict', `Agent '${agentId}' is already revoked`);
    }

    const [revoked] = await this.db
      .update(agentIdentities)
      .set({
        lifecycleState: 'revoked',
        updatedAt: new Date(),
      })
      .where(eq(agentIdentities.agentId, agentId))
      .returning();

    return revoked!;
  }

  async list(filters: {
    ownerUserId?: string;
    managerUserId?: string;
    lifecycleState?: string;
    limit: number;
    offset: number;
  }): Promise<{ data: AgentIdentity[]; total: number }> {
    const conditions = [];

    if (filters.ownerUserId) {
      conditions.push(eq(agentIdentities.ownerUserId, filters.ownerUserId));
    }
    if (filters.managerUserId) {
      conditions.push(eq(agentIdentities.managerUserId, filters.managerUserId));
    }
    if (filters.lifecycleState) {
      conditions.push(eq(agentIdentities.lifecycleState, filters.lifecycleState));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(agentIdentities)
        .where(whereClause)
        .limit(filters.limit)
        .offset(filters.offset)
        .orderBy(agentIdentities.createdAt),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentIdentities)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
    };
  }
}
