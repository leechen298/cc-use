import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Built source lives in dist/, templates ship at <pkg>/templates/
export const TEMPLATES_DIR = join(__dirname, '..', 'templates');

export interface TemplateMeta {
  name: string;
  description: string;
  defaults: Record<string, string>;
}

export function listTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function loadTemplate(name: string): TemplateMeta {
  const path = join(TEMPLATES_DIR, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `template '${name}' not found. Available: ${listTemplates().join(', ') || '(none)'}`,
    );
  }
  const raw = readFileSync(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`template '${name}' has invalid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`template '${name}' must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  const description = typeof obj.description === 'string' ? obj.description : '';
  const defaults =
    typeof obj.defaults === 'object' && obj.defaults !== null && !Array.isArray(obj.defaults)
      ? (obj.defaults as Record<string, string>)
      : {};
  return { name, description, defaults };
}
