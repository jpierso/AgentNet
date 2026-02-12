/** Canonical audit action constants */
export const AuditActions = {
  // Agent lifecycle
  AGENT_CREATED: 'agent.created',
  AGENT_UPDATED: 'agent.updated',
  AGENT_REVOKED: 'agent.revoked',
  AGENT_RETRIEVED: 'agent.retrieved',
  AGENT_LISTED: 'agent.listed',

  // Token operations
  TOKEN_ISSUED: 'token.issued',
  TOKEN_EXCHANGED: 'token.exchanged',
  TOKEN_EXCHANGE_DENIED: 'token.exchange.denied',

  // Permission operations
  PERMISSION_CREATED: 'permission.created',
  PERMISSION_UPDATED: 'permission.updated',
  PERMISSION_DELETED: 'permission.deleted',
  PERMISSION_RETRIEVED: 'permission.retrieved',
  PERMISSION_LISTED: 'permission.listed',

  // HTTP (auto-captured)
  HTTP_REQUEST: 'http.request',
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];

export const ActorTypes = {
  AGENT: 'agent',
  USER: 'user',
  SYSTEM: 'system',
} as const;

export type ActorType = (typeof ActorTypes)[keyof typeof ActorTypes];

export const Outcomes = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  DENIED: 'denied',
} as const;

export type Outcome = (typeof Outcomes)[keyof typeof Outcomes];

export const ResourceTypes = {
  AGENT: 'agent',
  PERMISSION: 'permission',
  TOKEN: 'token',
  HTTP: 'http',
} as const;

export type ResourceType = (typeof ResourceTypes)[keyof typeof ResourceTypes];
