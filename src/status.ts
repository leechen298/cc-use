import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAutoConfig } from './config.js';
import { STATUS_FILE } from './paths.js';

export type UsabilityReason =
  | 'balance_ok'
  | 'balance_below_threshold'
  | 'probe_ok'
  | 'probe_failed'
  | 'manual_available'
  | 'manual_unavailable'
  | 'check_failed'
  | 'unknown';

export interface UsabilityDetails {
  balance?: number;
  currency?: string;
  minBalance?: number;
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  adapter?: string;
}

export interface UsabilityResult {
  profileName: string;
  usable: boolean;
  reason: UsabilityReason;
  checkedAt: string;
  details?: UsabilityDetails;
}

interface StatusFile {
  profiles?: Record<string, UsabilityResult>;
}

export function readStatus(): Record<string, UsabilityResult> {
  if (!existsSync(STATUS_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) as StatusFile;
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.profiles === 'object') {
      return parsed.profiles ?? {};
    }
  } catch {
    // Ignore invalid cache; a future check will rewrite it.
  }
  return {};
}

export function getCachedStatus(profileName: string): UsabilityResult | undefined {
  return readStatus()[profileName];
}

export function saveStatus(result: UsabilityResult): void {
  const current = readStatus();
  current[result.profileName] = sanitizeResult(result);
  const dir = dirname(STATUS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATUS_FILE, JSON.stringify({ profiles: current }, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function isFresh(result: UsabilityResult, ttlSeconds: number, now = Date.now()): boolean {
  const checked = Date.parse(result.checkedAt);
  if (!Number.isFinite(checked)) return false;
  return now - checked <= ttlSeconds * 1000;
}

export function runStatus(): number {
  const auto = getAutoConfig();
  const names = Object.keys(auto.profiles);
  if (names.length === 0) {
    process.stdout.write(`cc-use status: no auto profiles configured.\n`);
    return 0;
  }

  const statuses = readStatus();
  process.stdout.write(`Profile        Usable  Reason                   Checked\n`);
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    const status = statuses[name];
    if (!status) {
      process.stdout.write(`${pad(name, 14)} ${pad('unknown', 7)} ${pad('unknown', 24)} never\n`);
      continue;
    }
    const usable = status.usable ? 'yes' : 'no';
    const age = formatAge(status.checkedAt);
    const stale = isFresh(status, auto.cacheTtlSeconds) ? '' : ' stale';
    process.stdout.write(
      `${pad(name, 14)} ${pad(usable, 7)} ${pad(status.reason, 24)} ${age}${stale}\n`,
    );
  }
  return 0;
}

function sanitizeResult(result: UsabilityResult): UsabilityResult {
  const details = sanitizeDetails(result.details);
  return details ? { ...result, details } : { ...result, details: undefined };
}

function sanitizeDetails(details: UsabilityDetails | undefined): UsabilityDetails | undefined {
  if (!details) return undefined;
  const out: UsabilityDetails = {};
  if (typeof details.balance === 'number') out.balance = details.balance;
  if (typeof details.currency === 'string') out.currency = details.currency;
  if (typeof details.minBalance === 'number') out.minBalance = details.minBalance;
  if (typeof details.httpStatus === 'number') out.httpStatus = details.httpStatus;
  if (typeof details.errorType === 'string') out.errorType = details.errorType;
  if (typeof details.errorMessage === 'string') out.errorMessage = redactMessage(details.errorMessage);
  if (typeof details.adapter === 'string') out.adapter = details.adapter;
  return Object.keys(out).length > 0 ? out : undefined;
}

function redactMessage(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/\b(api[_-]?key|token|secret|authorization|x-api-key)\s*[:=]\s*[^,\s]+/gi, '$1=***')
    .slice(0, 240);
}

function formatAge(checkedAt: string): string {
  const ts = Date.parse(checkedAt);
  if (!Number.isFinite(ts)) return 'invalid';
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}
