import { eq, and, gte, lte, sql, asc } from 'drizzle-orm';
import {
  auditIndex,
  type NewAuditEvent,
  type AuditEvent,
  type NewAuditIndexRow,
} from '../db/schema.js';
import type { Database } from '../db/connection.js';
import type { IAuditStore, AuditQueryFilters, AuditQueryResult } from './audit-store.js';
import type { IBlockchainClient } from './blockchain-client.js';

/**
 * Blockchain-backed audit store. Writes to consortium blockchain for tamper-evidence,
 * maintains local PostgreSQL index for fast queries.
 */
export class BlockchainAuditStore implements IAuditStore {
  constructor(
    private db: Database,
    private blockchain: IBlockchainClient,
  ) {}

  async record(event: NewAuditEvent): Promise<AuditEvent> {
    const eventJson = JSON.stringify(this.toSerializableEvent(event));
    const blockchainTxId = await this.blockchain.appendEvent(eventJson);

    const timestamp = event.timestamp ?? new Date();
    const row: NewAuditIndexRow = {
      blockchainTxId,
      traceId: event.traceId,
      spanId: event.spanId,
      parentSpanId: event.parentSpanId,
      timestamp,
      agentId: event.agentId,
      actorType: event.actorType,
      actorId: event.actorId,
      action: event.action,
      resource: event.resource,
      resourceType: event.resourceType,
      outcome: event.outcome,
      outcomeReason: event.outcomeReason,
      metadata: event.metadata,
      requestMethod: event.requestMethod,
      requestPath: event.requestPath,
      requestId: event.requestId,
      statusCode: event.statusCode,
      durationMs: event.durationMs,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    };

    const [inserted] = await this.db.insert(auditIndex).values(row).returning();
    return this.toAuditEvent(inserted!);
  }

  async recordBatch(events: NewAuditEvent[]): Promise<AuditEvent[]> {
    const results: AuditEvent[] = [];
    for (const event of events) {
      results.push(await this.record(event));
    }
    return results;
  }

  async query(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    const conditions = [];

    if (filters.agentId) {
      conditions.push(eq(auditIndex.agentId, filters.agentId));
    }
    if (filters.actorId) {
      conditions.push(eq(auditIndex.actorId, filters.actorId));
    }
    if (filters.actorType) {
      conditions.push(eq(auditIndex.actorType, filters.actorType));
    }
    if (filters.action) {
      conditions.push(eq(auditIndex.action, filters.action));
    }
    if (filters.resourceType) {
      conditions.push(eq(auditIndex.resourceType, filters.resourceType));
    }
    if (filters.outcome) {
      conditions.push(eq(auditIndex.outcome, filters.outcome));
    }
    if (filters.from) {
      conditions.push(gte(auditIndex.timestamp, filters.from));
    }
    if (filters.to) {
      conditions.push(lte(auditIndex.timestamp, filters.to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(auditIndex)
        .where(whereClause)
        .limit(filters.limit)
        .offset(filters.offset)
        .orderBy(asc(auditIndex.timestamp)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditIndex)
        .where(whereClause),
    ]);

    return {
      data: data.map(this.toAuditEvent),
      total: countResult[0]?.count ?? 0,
    };
  }

  async getTrace(traceId: string): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditIndex)
      .where(eq(auditIndex.traceId, traceId))
      .orderBy(asc(auditIndex.timestamp));
    return rows.map(this.toAuditEvent);
  }

  private toSerializableEvent(event: NewAuditEvent): Record<string, unknown> {
    return {
      traceId: event.traceId,
      spanId: event.spanId,
      parentSpanId: event.parentSpanId,
      timestamp: (event.timestamp ?? new Date()).toISOString(),
      agentId: event.agentId,
      actorType: event.actorType,
      actorId: event.actorId,
      action: event.action,
      resource: event.resource,
      resourceType: event.resourceType,
      outcome: event.outcome,
      outcomeReason: event.outcomeReason,
      metadata: event.metadata,
      requestMethod: event.requestMethod,
      requestPath: event.requestPath,
      requestId: event.requestId,
      statusCode: event.statusCode,
      durationMs: event.durationMs,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    };
  }

  private toAuditEvent(row: { id: string; timestamp: Date } & Record<string, unknown>): AuditEvent {
    return {
      id: row.id,
      traceId: row.traceId as string,
      spanId: row.spanId as string | null,
      parentSpanId: row.parentSpanId as string | null,
      timestamp: row.timestamp,
      agentId: row.agentId as string | null,
      actorType: row.actorType as string,
      actorId: row.actorId as string,
      action: row.action as string,
      resource: row.resource as string,
      resourceType: row.resourceType as string,
      outcome: row.outcome as string,
      outcomeReason: row.outcomeReason as string | null,
      metadata: row.metadata as Record<string, unknown> | null,
      requestMethod: row.requestMethod as string | null,
      requestPath: row.requestPath as string | null,
      requestId: row.requestId as string | null,
      statusCode: row.statusCode as number | null,
      durationMs: row.durationMs as number | null,
      ipAddress: row.ipAddress as string | null,
      userAgent: row.userAgent as string | null,
    };
  }
}
