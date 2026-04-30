import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS_DIR } from './paths.js';

function searchDirs(): string[] {
  return [PROVIDERS_DIR];
}

export const RESERVED_NAMES = new Set([
  'init',
  'ls',
  'list',
  'doctor',
  'default',
  'help',
  'version',
  'import-history',
  'with',
]);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export interface Profile {
  name: string;
  source: string;
  env: Record<string, string>;
}

export interface ProfileEntry {
  name: string;
  source: string;
}

export function isReserved(name: string): boolean {
  return RESERVED_NAMES.has(name);
}

export function validateProfileName(name: string): void {
  if (isReserved(name)) {
    throw new Error(`'${name}' is a reserved subcommand name`);
  }
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid profile name '${name}'. Use letters, digits, underscore, dash; start with a letter or underscore.`,
    );
  }
}

export function listProfiles(): ProfileEntry[] {
  const out: ProfileEntry[] = [];
  const seen = new Set<string>();
  for (const dir of searchDirs()) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      if (f.endsWith('.example.json') || f.endsWith('.json.example')) continue;
      const name = f.slice(0, -5);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, source: dir });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function profileExists(name: string): boolean {
  return listProfiles().some((p) => p.name === name);
}

function findProfilePath(name: string): string | undefined {
  for (const dir of searchDirs()) {
    const path = join(dir, `${name}.json`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function loadProfile(name: string): Profile {
  if (isReserved(name)) {
    throw new Error(`'${name}' is a reserved subcommand name`);
  }
  const found = findProfilePath(name);
  if (!found) {
    const available = listProfiles().map((p) => p.name);
    const hint = available.length
      ? `Available: ${available.join(', ')}`
      : `No profiles configured. Run: cc-use init`;
    throw new Error(`profile '${name}' not found. ${hint}`);
  }
  const raw = readFileSync(found, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`profile '${name}' has invalid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`profile '${name}' must be a JSON object`);
  }
  const env = validateEnv(parsed as Record<string, unknown>, name);
  return { name, source: found, env };
}

function validateEnv(obj: Record<string, unknown>, profileName: string): Record<string, string> {
  const env: Record<string, string> = {};
  const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  for (const [k, v] of Object.entries(obj)) {
    if (!ENV_KEY_RE.test(k)) {
      throw new Error(`profile '${profileName}': invalid env name '${k}'`);
    }
    if (typeof v === 'string') env[k] = v;
    else if (typeof v === 'number') env[k] = String(v);
    else if (typeof v === 'boolean') env[k] = v ? '1' : '0';
    // else skip
  }
  for (const required of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) {
    const value = env[required];
    if (!value || !value.trim()) {
      throw new Error(`profile '${profileName}' missing required field '${required}'`);
    }
  }
  return env;
}

export function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  return /^<.*>$/.test(v) || v === '' || v.toUpperCase() === 'YOUR_API_KEY';
}

const PLACEHOLDER_CHECK_KEYS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'];

export function findPlaceholders(env: Record<string, string>): string[] {
  return PLACEHOLDER_CHECK_KEYS.filter((k) => {
    const v = env[k];
    return typeof v === 'string' && looksLikePlaceholder(v);
  });
}
