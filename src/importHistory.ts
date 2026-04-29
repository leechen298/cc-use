import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { NATIVE_CLAUDE_DIR, sessionDirFor } from './paths.js';
import { profileExists } from './profile.js';

export interface ImportOptions {
  profile: string;
  all: boolean;
  sanitize: boolean;
  nativeClaudeDir?: string;
  cwd?: string;
}

export async function runImportHistory(opts: ImportOptions): Promise<number> {
  if (!profileExists(opts.profile)) {
    process.stderr.write(`cc-use: profile '${opts.profile}' not found.\n`);
    return 1;
  }

  const nativeProjects = join(opts.nativeClaudeDir ?? NATIVE_CLAUDE_DIR, 'projects');
  if (!existsSync(nativeProjects)) {
    process.stderr.write(
      `cc-use: native Claude Code projects dir not found at ${nativeProjects}. Nothing to import.\n`,
    );
    return 1;
  }

  const targetProjects = join(sessionDirFor(opts.profile), 'projects');
  mkdirSync(targetProjects, { recursive: true });

  let copied = 0;
  let dirs = 0;
  let sanitizedFiles = 0;

  if (opts.all) {
    for (const entry of readdirSync(nativeProjects)) {
      const src = join(nativeProjects, entry);
      if (!statSync(src).isDirectory()) continue;
      const result = copyDir(src, join(targetProjects, entry), opts.sanitize);
      copied += result.copiedFiles;
      sanitizedFiles += result.sanitizedFiles;
      dirs++;
    }
  } else {
    const cwd = opts.cwd ?? process.cwd();
    const cwdHash = encodeCwdToProjectFolder(cwd);
    const candidate = join(nativeProjects, cwdHash);
    if (!existsSync(candidate)) {
      process.stderr.write(
        `cc-use: no native history for current cwd (${cwd}).\n` +
          `        Looked for: ${candidate}\n` +
          `        Use --all to import every project.\n`,
      );
      return 1;
    }
    const result = copyDir(candidate, join(targetProjects, cwdHash), opts.sanitize);
    copied = result.copiedFiles;
    sanitizedFiles = result.sanitizedFiles;
    dirs = 1;
  }

  process.stdout.write(
    `cc-use: imported ${copied} file(s) across ${dirs} project dir(s) into\n` +
      `        ${targetProjects}\n` +
      (opts.sanitize ? `        sanitized ${sanitizedFiles} transcript file(s) for provider compatibility\n` : '') +
      `        ~/.claude/ untouched.\n`,
  );
  return 0;
}

function copyDir(src: string, dst: string, sanitize: boolean): { copiedFiles: number; sanitizedFiles: number } {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  let copiedFiles = 0;
  let sanitizedFiles = 0;
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const stat = statSync(s);
    if (stat.isDirectory()) {
      const nested = copyDir(s, d, sanitize);
      copiedFiles += nested.copiedFiles;
      sanitizedFiles += nested.sanitizedFiles;
    } else if (stat.isFile()) {
      copyFileSync(s, d);
      copiedFiles++;
      if (sanitize && d.endsWith('.jsonl') && sanitizeTranscriptFile(d)) {
        sanitizedFiles++;
      }
    }
  }
  return { copiedFiles, sanitizedFiles };
}

function sanitizeTranscriptFile(path: string): boolean {
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonRow);
  const result = sanitizeTranscriptRows(rows);
  if (!result.changed) return false;

  writeFileSync(path, result.rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  return true;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type JsonRow = JsonObject;

const DROPPED_CONTENT_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking']);
const TEXTUALIZED_CONTENT_BLOCK_TYPES = new Set([
  // Tool-call blocks are structurally supported by DeepSeek's Anthropic API, but
  // imported Claude thinking-mode tool chains cannot reliably carry DeepSeek's
  // required reasoning continuity. Textualizing them keeps history readable while
  // preventing the API from treating old tool calls as resumable tool state.
  'tool_use',
  'tool_result',
  'server_tool_use',
  'web_search_tool_result',
  'code_execution_tool_result',
  'mcp_tool_use',
  'mcp_tool_result',
  // DeepSeek Anthropic compatibility docs list these message block variants as
  // unsupported. Keep a text marker instead of sending the raw block.
  'image',
  'document',
  'search_result',
  'container_upload',
]);

export function sanitizeTranscriptRows(rows: JsonRow[]): { rows: JsonRow[]; changed: boolean } {
  const removedParents = new Map<string, string | null>();
  const output: JsonRow[] = [];
  let changed = false;

  for (const row of rows) {
    const sanitized = sanitizeRow(row);
    if (sanitized.removed) {
      const uuid = typeof row.uuid === 'string' ? row.uuid : null;
      const parentUuid = typeof row.parentUuid === 'string' ? row.parentUuid : null;
      if (uuid) removedParents.set(uuid, parentUuid);
      changed = true;
      continue;
    }

    let nextRow = sanitized.row;
    const parentUuid = typeof nextRow.parentUuid === 'string' ? nextRow.parentUuid : null;
    if (parentUuid && removedParents.has(parentUuid)) {
      let resolved = removedParents.get(parentUuid) ?? null;
      while (resolved && removedParents.has(resolved)) {
        resolved = removedParents.get(resolved) ?? null;
      }
      nextRow = { ...nextRow, parentUuid: resolved };
      changed = true;
    }

    if (nextRow !== row) changed = true;
    output.push(nextRow);
  }

  return { rows: output, changed };
}

function sanitizeRow(row: JsonRow): { row: JsonRow; removed: boolean } {
  const message = isJsonObject(row.message) ? row.message : null;
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return { row, removed: false };

  const sanitizedContent: JsonValue[] = [];
  let changed = false;

  for (const item of content) {
    if (!isJsonObject(item) || typeof item.type !== 'string') {
      sanitizedContent.push(item);
      continue;
    }

    if (DROPPED_CONTENT_BLOCK_TYPES.has(item.type)) {
      changed = true;
      continue;
    }

    if (TEXTUALIZED_CONTENT_BLOCK_TYPES.has(item.type)) {
      sanitizedContent.push(textualizeContentBlock(item));
      changed = true;
      continue;
    }

    sanitizedContent.push(item);
  }

  if (!changed) return { row, removed: false };
  if (sanitizedContent.length === 0) return { row, removed: true };

  return {
    row: {
      ...row,
      message: {
        ...message!,
        content: sanitizedContent,
      },
    },
    removed: false,
  };
}

function textualizeContentBlock(block: JsonObject): JsonObject {
  const type = typeof block.type === 'string' ? block.type : 'unknown';
  const label = summarizeContentBlock(block);
  const serialized = stableStringify(block);
  return {
    type: 'text',
    text: `[cc-use sanitized ${type} block${label ? `: ${label}` : ''}]\n${serialized}`,
  };
}

function summarizeContentBlock(block: JsonObject): string {
  const parts: string[] = [];
  if (typeof block.name === 'string') parts.push(block.name);
  if (typeof block.id === 'string') parts.push(block.id);
  if (typeof block.tool_use_id === 'string') parts.push(`tool_use_id=${block.tool_use_id}`);
  return parts.join(' ');
}

function stableStringify(value: JsonValue): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isJsonObject(value)) return value;

  const sorted: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue(value[key]!);
  }
  return sorted;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Claude Code encodes cwd as a project folder by replacing path separators with dashes.
// Windows drive separators also need normalization because ':' is not a valid
// filename character in a path segment.
// e.g. /Users/foo/work -> -Users-foo-work, C:\Users\foo\work -> C--Users-foo-work
function encodeCwdToProjectFolder(cwd: string): string {
  return cwd.replace(/[\\/:]/g, '-');
}
