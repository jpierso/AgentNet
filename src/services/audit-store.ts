import type { NewAuditEvent, AuditEvent } from '../db/schema.js';

export interface AuditQueryFilters {
  agentId?: string;
  actorId?: string;
  actorType?: string;
  action?: string;
  resourceType?: string;
  outcome?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface AuditQueryResult {
  data: AuditEvent[];
  total: number;
}

/** Immutable audit store interface — no update/delete by design */
export interface IAuditStore {
  record(event: NewAuditEvent): Promise<AuditEvent>;
  recordBatch(events: NewAuditEvent[]): Promise<AuditEvent[]>;
  query(filters: AuditQueryFilters): Promise<AuditQueryResult>;
  getTrace(traceId: string): Promise<AuditEvent[]>;
}
