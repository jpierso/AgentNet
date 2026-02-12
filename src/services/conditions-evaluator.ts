/**
 * Pure-function module for evaluating policy/permission conditions (time, day, IP).
 * No external dependencies — all logic self-contained.
 */

export interface PolicyConditions {
  allowed_hours?: { start: string; end: string };
  allowed_days?: string[];
  allowed_ips?: string[];
  denied_ips?: string[];
}

export interface ConditionContext {
  timestamp: Date;
  ipAddress?: string;
}

export interface ConditionResult {
  passed: boolean;
  failures: string[];
}

/** Parse "HH:MM" → minutes since midnight */
function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Parse IPv4 address → 32-bit number */
function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** Check if an IPv4 address matches a CIDR range */
export function cidrMatch(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  if (!network) return false;
  const prefix = prefixStr !== undefined ? Number(prefixStr) : 32;
  if (prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNumber(ip);
  const networkNum = ipToNumber(network);

  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (networkNum & mask);
}

/** Check if current time falls within allowed hours window */
export function checkHours(timestamp: Date, allowed: { start: string; end: string }): boolean {
  const minutes = timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
  const start = parseTime(allowed.start);
  const end = parseTime(allowed.end);

  if (start <= end) {
    // Normal window: e.g. 09:00 - 17:00
    return minutes >= start && minutes < end;
  } else {
    // Overnight window: e.g. 22:00 - 06:00
    return minutes >= start || minutes < end;
  }
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Check if current day matches allowed days */
export function checkDay(timestamp: Date, allowedDays: string[]): boolean {
  const dayName = DAY_NAMES[timestamp.getUTCDay()]!;
  return allowedDays.map((d) => d.toLowerCase()).includes(dayName);
}

/** Check IP against allowed/denied CIDR lists */
export function checkIp(
  ip: string,
  allowed?: string[],
  denied?: string[],
): { passed: boolean; reason?: string } {
  // Denied IPs checked first
  if (denied && denied.length > 0) {
    for (const cidr of denied) {
      if (cidrMatch(ip, cidr)) {
        return { passed: false, reason: `IP ${ip} matches denied CIDR ${cidr}` };
      }
    }
  }

  // Allowed IPs: if specified, IP must match at least one
  if (allowed && allowed.length > 0) {
    const matched = allowed.some((cidr) => cidrMatch(ip, cidr));
    if (!matched) {
      return { passed: false, reason: `IP ${ip} not in allowed CIDRs` };
    }
  }

  return { passed: true };
}

/**
 * Evaluate all conditions against the given context.
 * If a condition key is not present, it imposes no constraint (passes).
 */
export function evaluateConditions(
  conditions: PolicyConditions | null | undefined,
  context: ConditionContext,
): ConditionResult {
  if (!conditions) {
    return { passed: true, failures: [] };
  }

  const failures: string[] = [];

  // Time-based checks
  if (conditions.allowed_hours) {
    if (!checkHours(context.timestamp, conditions.allowed_hours)) {
      const hhmm = `${String(context.timestamp.getUTCHours()).padStart(2, '0')}:${String(context.timestamp.getUTCMinutes()).padStart(2, '0')}`;
      failures.push(
        `Current time ${hhmm} UTC outside allowed hours ${conditions.allowed_hours.start}-${conditions.allowed_hours.end}`,
      );
    }
  }

  if (conditions.allowed_days) {
    if (!checkDay(context.timestamp, conditions.allowed_days)) {
      const dayName = DAY_NAMES[context.timestamp.getUTCDay()]!;
      failures.push(
        `Current day '${dayName}' not in allowed days [${conditions.allowed_days.join(', ')}]`,
      );
    }
  }

  // IP-based checks
  if (context.ipAddress && (conditions.allowed_ips || conditions.denied_ips)) {
    const ipResult = checkIp(context.ipAddress, conditions.allowed_ips, conditions.denied_ips);
    if (!ipResult.passed && ipResult.reason) {
      failures.push(ipResult.reason);
    }
  }

  return { passed: failures.length === 0, failures };
}
