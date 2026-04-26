import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = homedir();
const CC_USE_DIR_EXPLICIT = typeof process.env.CC_USE_DIR === 'string' && process.env.CC_USE_DIR.length > 0;
export const CC_USE_DIR = CC_USE_DIR_EXPLICIT ? process.env.CC_USE_DIR! : join(HOME, '.cc-use');
export const PROVIDERS_DIR = join(CC_USE_DIR, 'providers');
export const SESSIONS_DIR = join(CC_USE_DIR, 'sessions');
export const CONFIG_FILE = join(CC_USE_DIR, 'config.json');
export const NATIVE_CLAUDE_DIR = join(HOME, '.claude');

export function profilePath(name: string): string {
  return join(PROVIDERS_DIR, `${name}.json`);
}

export function sessionDirFor(name: string): string {
  return join(SESSIONS_DIR, name);
}
