import { describe, it, expect } from 'vitest';
import {
  evaluateConditions,
  cidrMatch,
  checkHours,
  checkDay,
  checkIp,
} from '../src/services/conditions-evaluator.js';

describe('Conditions Evaluator', () => {
  describe('cidrMatch', () => {
    it('should match exact IP with /32', () => {
      expect(cidrMatch('192.168.1.1', '192.168.1.1/32')).toBe(true);
      expect(cidrMatch('192.168.1.2', '192.168.1.1/32')).toBe(false);
    });

    it('should match subnet with /24', () => {
      expect(cidrMatch('10.0.0.55', '10.0.0.0/24')).toBe(true);
      expect(cidrMatch('10.0.1.55', '10.0.0.0/24')).toBe(false);
    });

    it('should match broad subnet with /8', () => {
      expect(cidrMatch('10.255.255.255', '10.0.0.0/8')).toBe(true);
      expect(cidrMatch('11.0.0.0', '10.0.0.0/8')).toBe(false);
    });

    it('should match everything with /0', () => {
      expect(cidrMatch('1.2.3.4', '0.0.0.0/0')).toBe(true);
      expect(cidrMatch('255.255.255.255', '0.0.0.0/0')).toBe(true);
    });

    it('should treat bare IP as /32', () => {
      expect(cidrMatch('10.0.0.1', '10.0.0.1')).toBe(true);
      expect(cidrMatch('10.0.0.2', '10.0.0.1')).toBe(false);
    });
  });

  describe('checkHours', () => {
    it('should pass within normal business hours', () => {
      // 12:00 UTC, within 09:00-17:00
      const ts = new Date('2025-01-15T12:00:00Z');
      expect(checkHours(ts, { start: '09:00', end: '17:00' })).toBe(true);
    });

    it('should fail outside normal business hours', () => {
      // 20:00 UTC, outside 09:00-17:00
      const ts = new Date('2025-01-15T20:00:00Z');
      expect(checkHours(ts, { start: '09:00', end: '17:00' })).toBe(false);
    });

    it('should handle exact start boundary (inclusive)', () => {
      const ts = new Date('2025-01-15T09:00:00Z');
      expect(checkHours(ts, { start: '09:00', end: '17:00' })).toBe(true);
    });

    it('should handle exact end boundary (exclusive)', () => {
      const ts = new Date('2025-01-15T17:00:00Z');
      expect(checkHours(ts, { start: '09:00', end: '17:00' })).toBe(false);
    });

    it('should handle overnight window (e.g. 22:00-06:00)', () => {
      const midnight = new Date('2025-01-15T00:30:00Z');
      const afternoon = new Date('2025-01-15T14:00:00Z');
      const lateNight = new Date('2025-01-15T23:00:00Z');

      expect(checkHours(midnight, { start: '22:00', end: '06:00' })).toBe(true);
      expect(checkHours(lateNight, { start: '22:00', end: '06:00' })).toBe(true);
      expect(checkHours(afternoon, { start: '22:00', end: '06:00' })).toBe(false);
    });
  });

  describe('checkDay', () => {
    it('should match allowed weekdays', () => {
      // 2025-01-15 is a Wednesday
      const ts = new Date('2025-01-15T12:00:00Z');
      expect(checkDay(ts, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])).toBe(true);
    });

    it('should reject non-allowed days', () => {
      // 2025-01-18 is a Saturday
      const ts = new Date('2025-01-18T12:00:00Z');
      expect(checkDay(ts, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])).toBe(false);
    });

    it('should be case-insensitive', () => {
      const ts = new Date('2025-01-15T12:00:00Z'); // Wednesday
      expect(checkDay(ts, ['Wednesday'])).toBe(true);
      expect(checkDay(ts, ['WEDNESDAY'])).toBe(true);
    });
  });

  describe('checkIp', () => {
    it('should deny IP in denied list', () => {
      const result = checkIp('10.0.0.5', undefined, ['10.0.0.0/24']);
      expect(result.passed).toBe(false);
    });

    it('should allow IP in allowed list', () => {
      const result = checkIp('192.168.1.10', ['192.168.1.0/24'], undefined);
      expect(result.passed).toBe(true);
    });

    it('should deny IP not in allowed list', () => {
      const result = checkIp('172.16.0.1', ['192.168.1.0/24'], undefined);
      expect(result.passed).toBe(false);
    });

    it('should check denied before allowed (deny takes priority)', () => {
      // IP is in both denied and allowed ranges
      const result = checkIp('10.0.0.5', ['10.0.0.0/8'], ['10.0.0.0/24']);
      expect(result.passed).toBe(false);
    });

    it('should pass when no IP restrictions specified', () => {
      const result = checkIp('1.2.3.4', undefined, undefined);
      expect(result.passed).toBe(true);
    });
  });

  describe('evaluateConditions (combined)', () => {
    it('should pass when conditions are null', () => {
      const result = evaluateConditions(null, { timestamp: new Date() });
      expect(result.passed).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('should pass when conditions are empty object', () => {
      const result = evaluateConditions({}, { timestamp: new Date() });
      expect(result.passed).toBe(true);
    });

    it('should fail when time is outside allowed hours', () => {
      const result = evaluateConditions(
        { allowed_hours: { start: '09:00', end: '17:00' } },
        { timestamp: new Date('2025-01-15T20:00:00Z') },
      );
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toContain('outside allowed hours');
    });

    it('should fail with multiple condition violations', () => {
      // Saturday at 20:00 UTC from denied IP
      const result = evaluateConditions(
        {
          allowed_hours: { start: '09:00', end: '17:00' },
          allowed_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          denied_ips: ['10.0.0.0/8'],
        },
        { timestamp: new Date('2025-01-18T20:00:00Z'), ipAddress: '10.0.0.5' },
      );
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThanOrEqual(3);
    });

    it('should pass when all conditions are satisfied', () => {
      // Wednesday at 12:00 UTC from allowed IP
      const result = evaluateConditions(
        {
          allowed_hours: { start: '09:00', end: '17:00' },
          allowed_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          allowed_ips: ['192.168.0.0/16'],
        },
        { timestamp: new Date('2025-01-15T12:00:00Z'), ipAddress: '192.168.1.10' },
      );
      expect(result.passed).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('should skip IP check when no ipAddress in context', () => {
      const result = evaluateConditions(
        { allowed_ips: ['192.168.1.0/24'] },
        { timestamp: new Date() },
      );
      // No IP provided → no IP check → passes
      expect(result.passed).toBe(true);
    });
  });
});
