import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CC_USE_DIR, CONFIG_FILE } from './paths.js';

interface Config {
  default?: string;
  auto?: unknown;
}

export type AutoProfileMode = 'payg' | 'token_plan';

export type AutoCheckConfig =
  | { kind: 'api'; adapter: string }
  | { kind: 'probe' }
  | { kind: 'manual_availability'; available: boolean };

export interface AutoProfileConfig {
  // Mode is metadata for humans and future policy checks; v0.4 routing is driven by check.kind.
  mode?: AutoProfileMode;
  minBalance?: number;
  check?: AutoCheckConfig;
  recordUsage?: boolean;
}

export interface AutoConfig {
  cacheTtlSeconds: number;
  fallbackOrder: string[];
  profiles: Record<string, AutoProfileConfig>;
}

function readConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Config;
    }
  } catch {
    // ignore
  }
  return {};
}

function writeConfig(cfg: Config): void {
  if (!existsSync(CC_USE_DIR)) mkdirSync(CC_USE_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

export function getDefaultProfile(): string | undefined {
  const fromEnv = process.env.CC_USE_DEFAULT;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return readConfig().default;
}

export function getConfiguredDefaultProfile(): string | undefined {
  return readConfig().default;
}

export function getAutoConfig(): AutoConfig {
  return parseAutoConfig(readConfig().auto);
}

export function setDefaultProfile(name: string | undefined): void {
  const cfg = readConfig();
  if (name === undefined) delete cfg.default;
  else cfg.default = name;
  writeConfig(cfg);
}

function parseAutoConfig(value: unknown): AutoConfig {
  const obj = isPlainObject(value) ? value : {};
  const cacheTtlSeconds =
    typeof obj.cacheTtlSeconds === 'number' && Number.isFinite(obj.cacheTtlSeconds) && obj.cacheTtlSeconds >= 0
      ? obj.cacheTtlSeconds
      : 60;
  const fallbackOrder = Array.isArray(obj.fallbackOrder)
    ? obj.fallbackOrder.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const profiles: Record<string, AutoProfileConfig> = {};
  const rawProfiles = isPlainObject(obj.profiles) ? obj.profiles : {};
  for (const [name, raw] of Object.entries(rawProfiles)) {
    if (!isPlainObject(raw)) continue;
    const cfg: AutoProfileConfig = {};
    if (raw.mode === 'payg' || raw.mode === 'token_plan') cfg.mode = raw.mode;
    if (typeof raw.minBalance === 'number' && Number.isFinite(raw.minBalance)) {
      cfg.minBalance = raw.minBalance;
    }
    const check = parseAutoCheck(raw.check);
    if (check) cfg.check = check;
    if (typeof raw.recordUsage === 'boolean') cfg.recordUsage = raw.recordUsage;
    profiles[name] = cfg;
  }
  return { cacheTtlSeconds, fallbackOrder, profiles };
}

function parseAutoCheck(value: unknown): AutoCheckConfig | undefined {
  if (!isPlainObject(value)) return undefined;
  if (value.kind === 'probe') return { kind: 'probe' };
  if (value.kind === 'api' && typeof value.adapter === 'string' && value.adapter.length > 0) {
    return { kind: 'api', adapter: value.adapter };
  }
  if (value.kind === 'manual_availability' && typeof value.available === 'boolean') {
    return { kind: 'manual_availability', available: value.available };
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
