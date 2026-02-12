import { eq, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { tokenRevocations } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import type { RevocationSet } from './revocation-set.js';

export class TokenRevocationService {
  constructor(
    private db: Database,
    private revocationSet: RevocationSet,
  ) {}

  /**
   * Revoke a single token by JTI. Persists to DB and updates in-memory set.
   */
  async revokeByJti(params: {
    jti: string;
    agentId: string;
    parentJti?: string;
    revokedBy: string;
    reason: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(tokenRevocations).values({
      jti: params.jti,
      agentId: params.agentId,
      parentJti: params.parentJti ?? null,
      revokedBy: params.revokedBy,
      reason: params.reason,
      expiresAt: params.expiresAt,
    });

    this.revocationSet.addJti(params.jti);
  }

  /**
   * Blanket-revoke all tokens for an agent issued before now.
   * Updates in-memory set for immediate effect.
   */
  async revokeByAgent(params: {
    agentId: string;
    revokedBy: string;
    reason: string;
  }): Promise<void> {
    // Use now + 1 so tokens issued at the current second are also caught
    // (iat has second precision, and isRevoked uses strict less-than)
    const revokeTs = Math.floor(Date.now() / 1000) + 1;
    this.revocationSet.addAgentRevocation(params.agentId, revokeTs);

    // Persist a sentinel record so we can hydrate on restart
    await this.db.insert(tokenRevocations).values({
      jti: `blanket:${params.agentId}:${revokeTs}:${randomUUID().slice(0, 8)}`,
      agentId: params.agentId,
      revokedBy: params.revokedBy,
      reason: params.reason,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour default
    });
  }

  /**
   * Hydrate the in-memory revocation set from the DB.
   * Called at startup.
   */
  async loadRevocations(): Promise<void> {
    const rows = await this.db
      .select()
      .from(tokenRevocations)
      .where(lte(tokenRevocations.createdAt, new Date()));

    for (const row of rows) {
      if (row.jti.startsWith('blanket:')) {
        // Parse blanket sentinel: blanket:<agentId>:<timestamp>
        const parts = row.jti.split(':');
        const ts = parseInt(parts[2]!, 10);
        if (!isNaN(ts)) {
          this.revocationSet.addAgentRevocation(row.agentId, ts);
        }
      } else {
        this.revocationSet.addJti(row.jti);
      }
    }
  }

  /**
   * Clean up expired revocation records from the DB.
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.db
      .delete(tokenRevocations)
      .where(lte(tokenRevocations.expiresAt, new Date()))
      .returning();

    return result.length;
  }
}
