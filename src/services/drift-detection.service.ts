import { eq, and, sql, desc } from 'drizzle-orm';
import { attestationItems, permissionBoundaries, agentIdentities } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import type { AgentDriftResponse, DriftItem } from '../schemas/drift-detection.schema.js';

export class DriftDetectionService {
  constructor(private db: Database) {}

  async detectDrift(agentId: string): Promise<AgentDriftResponse> {
    // Get the most recent attested items for this agent (baseline)
    const attestedItems = await this.db
      .select()
      .from(attestationItems)
      .where(
        and(
          eq(attestationItems.agentId, agentId),
          eq(attestationItems.status, 'attested'),
        ),
      )
      .orderBy(desc(attestationItems.decidedAt));

    // Build a baseline map: permissionId -> snapshot
    // Use only the latest attestation per permissionId
    const baselineMap = new Map<string, { snapshot: Record<string, unknown>; campaignId: string }>();
    for (const item of attestedItems) {
      if (!baselineMap.has(item.permissionId)) {
        baselineMap.set(item.permissionId, {
          snapshot: item.permissionSnapshot as Record<string, unknown>,
          campaignId: item.campaignId,
        });
      }
    }

    // Get current permissions
    const currentPermissions = await this.db
      .select()
      .from(permissionBoundaries)
      .where(eq(permissionBoundaries.agentId, agentId));

    const currentMap = new Map<string, typeof currentPermissions[0]>();
    for (const perm of currentPermissions) {
      currentMap.set(perm.id, perm);
    }

    const drifts: DriftItem[] = [];
    let baselineCampaignId: string | null = null;

    // Check for modified or removed permissions
    for (const [permId, baseline] of baselineMap) {
      baselineCampaignId = baselineCampaignId ?? baseline.campaignId;
      const current = currentMap.get(permId);

      if (!current) {
        // Permission was removed since attestation
        drifts.push({
          permissionId: permId,
          resource: (baseline.snapshot.resource as string) ?? 'unknown',
          driftType: 'removed',
          baseline: baseline.snapshot,
          current: null,
        });
      } else {
        // Check if permission was modified
        const currentSnapshot = {
          resource: current.resource,
          allowedActions: current.allowedActions,
          actionTier: current.actionTier,
          conditions: current.conditions,
        };

        if (!snapshotsEqual(baseline.snapshot, currentSnapshot)) {
          drifts.push({
            permissionId: permId,
            resource: current.resource,
            driftType: 'modified',
            baseline: baseline.snapshot,
            current: currentSnapshot as Record<string, unknown>,
          });
        }
      }
    }

    // Check for added permissions (not in baseline)
    for (const perm of currentPermissions) {
      if (!baselineMap.has(perm.id)) {
        drifts.push({
          permissionId: perm.id,
          resource: perm.resource,
          driftType: 'added',
          baseline: null,
          current: {
            resource: perm.resource,
            allowedActions: perm.allowedActions,
            actionTier: perm.actionTier,
            conditions: perm.conditions,
          } as Record<string, unknown>,
        });
      }
    }

    return {
      agentId,
      hasDrift: drifts.length > 0,
      drifts,
      baselineCampaignId,
      detectedAt: new Date().toISOString(),
    };
  }

  async detectDriftBatch(ownerUserId?: string): Promise<AgentDriftResponse[]> {
    const conditions = ownerUserId
      ? eq(agentIdentities.ownerUserId, ownerUserId)
      : undefined;

    const agents = await this.db
      .select()
      .from(agentIdentities)
      .where(conditions)
      .orderBy(agentIdentities.createdAt);

    const results: AgentDriftResponse[] = [];
    for (const agent of agents) {
      const drift = await this.detectDrift(agent.agentId);
      results.push(drift);
    }

    return results;
  }
}

function snapshotsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}
