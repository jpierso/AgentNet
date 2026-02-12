/**
 * Policy engine interface and types.
 * Swappable to OPA/Cedar later by implementing IPolicyEngine.
 */

export interface PolicyContext {
  agentId: string;
  agentType: string;
  resource: string;
  action: string;
  actionTier: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  conditions?: Record<string, unknown>;
}

export interface PolicyDecision {
  effect: 'allow' | 'deny' | 'require_approval';
  matchedRules: Array<{ ruleId: string; name: string; effect: string }>;
  reasons: string[];
}

export interface IPolicyEngine {
  evaluate(context: PolicyContext): Promise<PolicyDecision>;
  evaluateBatch(contexts: PolicyContext[]): Promise<PolicyDecision[]>;
}
