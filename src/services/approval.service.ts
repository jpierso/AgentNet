import { eq, and, lt } from 'drizzle-orm';
import { approvalRequests } from '../db/schema.js';
import type { ApprovalRequest } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import { AppError } from '../plugins/error-handler.plugin.js';

export interface CreateApprovalInput {
  agentId: string;
  requestedBy: string;
  requestedScopes: string[];
  grantedPermissions: Array<{ resource: string; actions: string[]; tier: string }>;
  parentTokenJti: string;
  ttlMinutes: number;
  expiresInMinutes?: number; // approval request TTL, default 30
}

export interface ReviewApprovalInput {
  decision: 'approved' | 'denied';
  reviewedBy: string;
  note?: string;
}

export class ApprovalService {
  constructor(private db: Database) {}

  async create(input: CreateApprovalInput): Promise<ApprovalRequest> {
    const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 30) * 60 * 1000);

    const [approval] = await this.db
      .insert(approvalRequests)
      .values({
        agentId: input.agentId,
        requestedBy: input.requestedBy,
        requestedScopes: input.requestedScopes,
        grantedPermissions: input.grantedPermissions,
        parentTokenJti: input.parentTokenJti,
        ttlMinutes: input.ttlMinutes,
        expiresAt,
      })
      .returning();

    return approval!;
  }

  async getById(approvalId: string): Promise<ApprovalRequest> {
    const [approval] = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, approvalId))
      .limit(1);

    if (!approval) {
      throw new AppError(404, 'Not Found', `Approval request '${approvalId}' not found`);
    }

    // Auto-expire if past expiresAt
    if (approval.status === 'pending' && approval.expiresAt < new Date()) {
      const [expired] = await this.db
        .update(approvalRequests)
        .set({ status: 'expired' })
        .where(eq(approvalRequests.id, approvalId))
        .returning();
      return expired!;
    }

    return approval;
  }

  async review(approvalId: string, input: ReviewApprovalInput): Promise<ApprovalRequest> {
    const approval = await this.getById(approvalId);

    if (approval.status !== 'pending') {
      throw new AppError(
        409,
        'Conflict',
        `Approval request is already '${approval.status}', cannot review`,
      );
    }

    const [updated] = await this.db
      .update(approvalRequests)
      .set({
        status: input.decision,
        reviewedBy: input.reviewedBy,
        reviewedAt: new Date(),
        reviewNote: input.note ?? null,
      })
      .where(eq(approvalRequests.id, approvalId))
      .returning();

    return updated!;
  }

  /**
   * Validate an approval for token exchange replay.
   * Returns the approval if valid, throws otherwise.
   */
  async validateForExchange(
    approvalId: string,
    agentId: string,
    scopes: string[],
  ): Promise<ApprovalRequest> {
    const approval = await this.getById(approvalId);

    if (approval.status !== 'approved') {
      throw new AppError(
        403,
        'Forbidden',
        `Approval request status is '${approval.status}', expected 'approved'`,
      );
    }

    if (approval.agentId !== agentId) {
      throw new AppError(
        403,
        'Forbidden',
        `Approval request agent '${approval.agentId}' does not match '${agentId}'`,
      );
    }

    // Verify scopes match
    const approvedScopes = approval.requestedScopes as string[];
    const allScopesMatch = scopes.every((s) => approvedScopes.includes(s));
    if (!allScopesMatch) {
      throw new AppError(
        403,
        'Forbidden',
        'Requested scopes do not match approved scopes',
      );
    }

    return approval;
  }

  /** Expire all pending approvals past their expiresAt */
  async expirePending(): Promise<number> {
    const result = await this.db
      .update(approvalRequests)
      .set({ status: 'expired' })
      .where(
        and(
          eq(approvalRequests.status, 'pending'),
          lt(approvalRequests.expiresAt, new Date()),
        ),
      )
      .returning();

    return result.length;
  }
}
