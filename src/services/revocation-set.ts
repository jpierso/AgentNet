/**
 * In-memory revocation set for real-time token revocation checks.
 * Hydrated from DB at startup; updated in-process on revocation events.
 */
export class RevocationSet {
  private revokedJtis = new Set<string>();
  private agentRevocations = new Map<string, number>(); // agentId → unix timestamp

  addJti(jti: string): void {
    this.revokedJtis.add(jti);
  }

  addAgentRevocation(agentId: string, timestamp: number): void {
    const existing = this.agentRevocations.get(agentId);
    if (!existing || timestamp > existing) {
      this.agentRevocations.set(agentId, timestamp);
    }
  }

  isRevoked(jti: string, agentId: string, iat: number, parentJti?: string): boolean {
    // 1. Direct JTI revocation
    if (this.revokedJtis.has(jti)) return true;

    // 2. Parent JTI cascade
    if (parentJti && this.revokedJtis.has(parentJti)) return true;

    // 3. Blanket agent revocation: all tokens issued before the timestamp
    const blanketTs = this.agentRevocations.get(agentId);
    if (blanketTs !== undefined && iat < blanketTs) return true;

    return false;
  }

  get jtiCount(): number {
    return this.revokedJtis.size;
  }

  get agentRevocationCount(): number {
    return this.agentRevocations.size;
  }

  clear(): void {
    this.revokedJtis.clear();
    this.agentRevocations.clear();
  }
}
