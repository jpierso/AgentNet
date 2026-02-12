import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { RevocationSet } from '../src/services/revocation-set.js';

describe('RevocationSet', () => {
  let rs: RevocationSet;

  beforeEach(() => {
    rs = new RevocationSet();
  });

  it('should start empty', () => {
    expect(rs.jtiCount).toBe(0);
    expect(rs.agentRevocationCount).toBe(0);
  });

  it('should detect a revoked JTI', () => {
    rs.addJti('jti-1');
    expect(rs.isRevoked('jti-1', 'agent-a', 1000)).toBe(true);
  });

  it('should not flag an unknown JTI', () => {
    rs.addJti('jti-1');
    expect(rs.isRevoked('jti-2', 'agent-a', 1000)).toBe(false);
  });

  it('should cascade to parent JTI', () => {
    rs.addJti('parent-jti');
    expect(rs.isRevoked('child-jti', 'agent-a', 1000, 'parent-jti')).toBe(true);
  });

  it('should not cascade when parent JTI is not revoked', () => {
    rs.addJti('other-jti');
    expect(rs.isRevoked('child-jti', 'agent-a', 1000, 'parent-jti')).toBe(false);
  });

  it('should detect blanket agent revocation for tokens issued before timestamp', () => {
    rs.addAgentRevocation('agent-a', 2000);
    expect(rs.isRevoked('jti-x', 'agent-a', 1500)).toBe(true);
    expect(rs.isRevoked('jti-x', 'agent-a', 1999)).toBe(true);
  });

  it('should not flag tokens issued at or after blanket revocation timestamp', () => {
    rs.addAgentRevocation('agent-a', 2000);
    expect(rs.isRevoked('jti-x', 'agent-a', 2000)).toBe(false);
    expect(rs.isRevoked('jti-x', 'agent-a', 2001)).toBe(false);
  });

  it('should not flag tokens of other agents on blanket revocation', () => {
    rs.addAgentRevocation('agent-a', 2000);
    expect(rs.isRevoked('jti-x', 'agent-b', 1500)).toBe(false);
  });

  it('should use the latest timestamp for agent blanket revocation', () => {
    rs.addAgentRevocation('agent-a', 1000);
    rs.addAgentRevocation('agent-a', 3000);
    expect(rs.isRevoked('jti-x', 'agent-a', 2500)).toBe(true);
    // Earlier timestamp should not override later
    rs.addAgentRevocation('agent-a', 500);
    expect(rs.isRevoked('jti-x', 'agent-a', 2500)).toBe(true);
  });

  it('should clear all revocations', () => {
    rs.addJti('jti-1');
    rs.addAgentRevocation('agent-a', 2000);
    rs.clear();
    expect(rs.jtiCount).toBe(0);
    expect(rs.agentRevocationCount).toBe(0);
    expect(rs.isRevoked('jti-1', 'agent-a', 1000)).toBe(false);
  });
});
