import { eq, and, gte, lte, sql, asc } from 'drizzle-orm';
import { auditEvents, type NewAuditEvent, type AuditEvent } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import type { IAuditStore, AuditQueryFilters, AuditQueryResult } from './audit-store.js';

export class PgAuditStore implements IAuditStore {
  constructor(private db: Database) {}

  async record(event: NewAuditEvent): Promise<AuditEvent> {
    const [inserted] = await this.db
      .insert(auditEvents)
      .values(event)
      .returning();
    return inserted!;
  }

  async recordBatch(events: NewAuditEvent[]): Promise<AuditEvent[]> {
    if (events.length === 0) return [];
    return this.db.insert(auditEvents).values(events).returning();
  }

  async query(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    const conditions = [];

    if (filters.agentId) {
      conditions.push(eq(auditEvents.agentId, filters.agentId));
    }
    if (filters.actorId) {
      conditions.push(eq(auditEvents.actorId, filters.actorId));
    }
    if (filters.actorType) {
      conditions.push(eq(auditEvents.actorType, filters.actorType));
    }
    if (filters.action) {
      conditions.push(eq(auditEvents.action, filters.action));
    }
    if (filters.resourceType) {
      conditions.push(eq(auditEvents.resourceType, filters.resourceType));
    }
    if (filters.outcome) {
      conditions.push(eq(auditEvents.outcome, filters.outcome));
    }
    if (filters.from) {
      conditions.push(gte(auditEvents.timestamp, filters.from));
    }
    if (filters.to) {
      conditions.push(lte(auditEvents.timestamp, filters.to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(auditEvents)
        .where(whereClause)
        .limit(filters.limit)
        .offset(filters.offset)
        .orderBy(asc(auditEvents.timestamp)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEvents)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
    };
  }

  async getTrace(traceId: string): Promise<AuditEvent[]> {
    return this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.traceId, traceId))
      .orderBy(asc(auditEvents.timestamp));
  }
}
