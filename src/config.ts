import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CC_USE_DIR, CONFIG_FILE } from './paths.js';

interface Config {
  default?: string;
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

export function setDefaultProfile(name: string | undefined): void {
  const cfg = readConfig();
  if (name === undefined) delete cfg.default;
  else cfg.default = name;
  writeConfig(cfg);
}
