import { eq, desc } from 'drizzle-orm';
import { policyRules } from '../db/schema.js';
import type { PolicyRule } from '../db/schema.js';
import type { Database } from '../db/connection.js';
import type { IPolicyEngine, PolicyContext, PolicyDecision } from './policy-engine.js';
import { evaluateConditions, type PolicyConditions } from './conditions-evaluator.js';

/** Simple glob-style pattern matching: `*` matches any string */
function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true;

  // Convert glob to regex: escape special regex chars, replace * with .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export class PgPolicyEngine implements IPolicyEngine {
  constructor(private db: Database) {}

  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    const matchedRules: PolicyDecision['matchedRules'] = [];
    const reasons: string[] = [];

    // 1. Tier enforcement (hardcoded, highest priority)
    if (context.actionTier === 'tier_3') {
      return {
        effect: 'deny',
        matchedRules: [],
        reasons: ['Tier 3 operations are blocked for agents'],
      };
    }

    if (context.actionTier === 'tier_2') {
      return {
        effect: 'require_approval',
        matchedRules: [],
        reasons: ['Tier 2 operations require approval'],
      };
    }

    // 2. Policy rules from DB (sorted by priority DESC)
    const rules = await this.db
      .select()
      .from(policyRules)
      .where(eq(policyRules.enabled, true))
      .orderBy(desc(policyRules.priority));

    for (const rule of rules) {
      if (!this.matchesRule(rule, context)) continue;

      // Evaluate rule conditions
      const condResult = evaluateConditions(
        rule.conditions as PolicyConditions | null,
        { timestamp: context.timestamp, ipAddress: context.ipAddress },
      );

      if (!condResult.passed) continue; // Conditions not met → rule doesn't apply

      matchedRules.push({ ruleId: rule.id, name: rule.name, effect: rule.effect });
      reasons.push(`Rule '${rule.name}' matched: ${rule.effect}`);

      // First matching rule wins
      return {
        effect: rule.effect as PolicyDecision['effect'],
        matchedRules,
        reasons,
      };
    }

    // 3. Permission boundary conditions
    if (context.conditions) {
      const condResult = evaluateConditions(
        context.conditions as PolicyConditions,
        { timestamp: context.timestamp, ipAddress: context.ipAddress },
      );

      if (!condResult.passed) {
        return {
          effect: 'deny',
          matchedRules,
          reasons: condResult.failures,
        };
      }
    }

    // 4. Default: allow (permission boundary already validated by validateScope)
    return { effect: 'allow', matchedRules, reasons };
  }

  async evaluateBatch(contexts: PolicyContext[]): Promise<PolicyDecision[]> {
    return Promise.all(contexts.map((ctx) => this.evaluate(ctx)));
  }

  private matchesRule(rule: PolicyRule, context: PolicyContext): boolean {
    // Match resource pattern
    if (!globMatch(rule.resourcePattern, context.resource)) return false;

    // Match action pattern
    if (!globMatch(rule.actionPattern, context.action)) return false;

    // Match optional agent type
    if (rule.agentTypePattern && !globMatch(rule.agentTypePattern, context.agentType)) return false;

    // Match optional tier constraint
    if (rule.tier && rule.tier !== context.actionTier) return false;

    return true;
  }
}
