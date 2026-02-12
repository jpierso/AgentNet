import type { AgentIdentity } from '../db/schema.js';

export interface AgentTokenClaims {
  sub: string;
  jti: string;
  agent_id: string;
  owner_user_id: string;
  manager_user_id: string;
  agent_type: string;
  lifecycle_state: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface DownscopedTokenClaims extends AgentTokenClaims {
  token_type: 'downscoped';
  parent_token_jti: string;
  permissions: Array<{ resource: string; actions: string[]; tier: string }>;
  scope: string[];
}

export interface TokenResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  expiresAt: string;
}

export interface DownscopedTokenResult extends TokenResult {
  scope: string[];
  tokenKind: 'downscoped';
}

export interface IIdentityProvider {
  issueToken(agent: AgentIdentity, ttlMinutes: number): Promise<TokenResult>;
  issueDownscopedToken(
    parentClaims: AgentTokenClaims,
    scope: string[],
    permissions: Array<{ resource: string; actions: string[]; tier: string }>,
    ttlMinutes: number,
  ): Promise<DownscopedTokenResult>;
  verifyToken(token: string): Promise<AgentTokenClaims>;
  validateUser(userId: string): Promise<boolean>;
}
