import type { NewAuditEvent, AuditEvent } from '../db/schema.js';
import type { IAuditStore, AuditQueryFilters, AuditQueryResult } from './audit-store.js';
import type { AuditAction, ActorType, Outcome, ResourceType } from './audit-events.js';

export interface RecordEventInput {
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  agentId?: string;
  actorType: ActorType;
  actorId: string;
  action: AuditAction;
  resource: string;
  resourceType: ResourceType;
  outcome: Outcome;
  outcomeReason?: string;
  metadata?: Record<string, unknown>;
  requestMethod?: string;
  requestPath?: string;
  requestId?: string;
  statusCode?: number;
  durationMs?: number;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  constructor(private store: IAuditStore) {}

  async record(input: RecordEventInput): Promise<AuditEvent> {
    const event: NewAuditEvent = {
      traceId: input.traceId,
      spanId: input.spanId ?? null,
      parentSpanId: input.parentSpanId ?? null,
      agentId: input.agentId ?? null,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resource: input.resource,
      resourceType: input.resourceType,
      outcome: input.outcome,
      outcomeReason: input.outcomeReason ?? null,
      metadata: input.metadata ?? null,
      requestMethod: input.requestMethod ?? null,
      requestPath: input.requestPath ?? null,
      requestId: input.requestId ?? null,
      statusCode: input.statusCode ?? null,
      durationMs: input.durationMs ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
    return this.store.record(event);
  }

  async recordBatch(inputs: RecordEventInput[]): Promise<AuditEvent[]> {
    const events: NewAuditEvent[] = inputs.map((input) => ({
      traceId: input.traceId,
      spanId: input.spanId ?? null,
      parentSpanId: input.parentSpanId ?? null,
      agentId: input.agentId ?? null,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resource: input.resource,
      resourceType: input.resourceType,
      outcome: input.outcome,
      outcomeReason: input.outcomeReason ?? null,
      metadata: input.metadata ?? null,
      requestMethod: input.requestMethod ?? null,
      requestPath: input.requestPath ?? null,
      requestId: input.requestId ?? null,
      statusCode: input.statusCode ?? null,
      durationMs: input.durationMs ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    }));
    return this.store.recordBatch(events);
  }

  async query(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    return this.store.query(filters);
  }

  async getTrace(traceId: string): Promise<AuditEvent[]> {
    return this.store.getTrace(traceId);
  }
}
