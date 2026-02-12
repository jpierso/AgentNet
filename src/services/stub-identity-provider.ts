import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { AgentIdentity } from '../db/schema.js';
import type {
  IIdentityProvider,
  AgentTokenClaims,
  TokenResult,
  DownscopedTokenResult,
} from './identity-provider.js';
import { AppError } from '../plugins/error-handler.plugin.js';
import { env } from '../config/env.js';

export class StubIdentityProvider implements IIdentityProvider {
  private secret: string;
  private issuer: string;
  private audience: string;

  constructor() {
    this.secret = env.JWT_SECRET;
    this.issuer = env.JWT_ISSUER;
    this.audience = env.JWT_AUDIENCE;
  }

  async issueToken(agent: AgentIdentity, ttlMinutes: number): Promise<TokenResult> {
    if (agent.lifecycleState !== 'active') {
      throw new AppError(
        403,
        'Forbidden',
        `Cannot issue token: agent '${agent.agentId}' is ${agent.lifecycleState}`,
      );
    }

    const expiresInSeconds = ttlMinutes * 60;

    const claims = {
      sub: agent.agentId,
      jti: randomUUID(),
      agent_id: agent.agentId,
      owner_user_id: agent.ownerUserId,
      manager_user_id: agent.managerUserId,
      agent_type: agent.agentType,
      lifecycle_state: agent.lifecycleState,
    };

    const accessToken = jwt.sign(claims, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: expiresInSeconds,
    });

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: expiresInSeconds,
      expiresAt,
    };
  }

  async issueDownscopedToken(
    parentClaims: AgentTokenClaims,
    scope: string[],
    permissions: Array<{ resource: string; actions: string[]; tier: string }>,
    ttlMinutes: number,
  ): Promise<DownscopedTokenResult> {
    // Cap TTL at parent token's remaining time
    const parentRemainingSeconds = parentClaims.exp - Math.floor(Date.now() / 1000);
    const requestedSeconds = ttlMinutes * 60;
    const expiresInSeconds = Math.min(requestedSeconds, parentRemainingSeconds);

    if (expiresInSeconds <= 0) {
      throw new AppError(401, 'Unauthorized', 'Parent token has expired');
    }

    const claims = {
      sub: parentClaims.sub,
      jti: randomUUID(),
      agent_id: parentClaims.agent_id,
      owner_user_id: parentClaims.owner_user_id,
      manager_user_id: parentClaims.manager_user_id,
      agent_type: parentClaims.agent_type,
      lifecycle_state: parentClaims.lifecycle_state,
      token_type: 'downscoped' as const,
      parent_token_jti: parentClaims.jti,
      permissions,
      scope,
    };

    const accessToken = jwt.sign(claims, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: expiresInSeconds,
    });

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: expiresInSeconds,
      expiresAt,
      scope,
      tokenKind: 'downscoped',
    };
  }

  async verifyToken(token: string): Promise<AgentTokenClaims> {
    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: this.issuer,
        audience: this.audience,
      }) as AgentTokenClaims;
      return decoded;
    } catch {
      throw new AppError(401, 'Unauthorized', 'Invalid or expired token');
    }
  }

  async validateUser(userId: string): Promise<boolean> {
    // Stub: accept any valid UUID format.
    // In production, this calls Okta's /api/v1/users/{userId}
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(userId);
  }
}
