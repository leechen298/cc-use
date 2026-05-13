import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { NATIVE_CLAUDE_DIR, sessionDirFor } from './paths.js';
import { profileExists } from './profile.js';
import { sanitizeTranscriptFile } from './importHistory.js';

export const SAFE_CATEGORIES = [
  'projects',
  'settings-safe',
  'agents',
  'skills',
  'commands',
] as const;
export const RISKY_CATEGORIES = ['settings-raw', 'mcp', 'hooks', 'plugins'] as const;

export type SafeCategory = (typeof SAFE_CATEGORIES)[number];
export type RiskyCategory = (typeof RISKY_CATEGORIES)[number];
export type Category = SafeCategory | RiskyCategory | 'unknown';

// v0.6 default safe sync categories for isolate launch-time replication.
export const DEFAULT_SAFE_CATEGORIES: SafeCategory[] = [
  'projects',
  'settings-safe',
  'agents',
  'skills',
  'commands',
];

// Extremely conservative allowlist for settings-safe.
// Unknown fields are skipped by default and reported in dry-run.
const SETTINGS_SAFE_ALLOWLIST = new Set([
  'theme',
  'effortLevel',
  'language',
  'autoUpdates',
  'verbose',
  'editor',
  'notifications',
]);

export interface ImportContextOptions {
  profile: string;
  dryRun: boolean;
  force: boolean;
  include: SafeCategory[];
  exclude: SafeCategory[];
  includeRisky: RiskyCategory[];
  all: boolean;
  sanitizeHistory: boolean;
  nativeClaudeDir?: string;
}

interface PlanItem {
  category: Category;
  src: string;
  dst: string;
  type: 'file' | 'dir';
  conflict: boolean;
  skippedKeys?: string[];
}

interface Plan {
  toCopy: PlanItem[];
  skipped: { category: Category; reason: string }[];
  conflicts: PlanItem[];
}

export async function runImportContext(opts: ImportContextOptions): Promise<number> {
  if (!profileExists(opts.profile)) {
    process.stderr.write(`cc-use: profile '${opts.profile}' not found.\n`);
    return 1;
  }

  // Validate explicit include categories are safe
  for (const cat of opts.include) {
    if (!SAFE_CATEGORIES.includes(cat as SafeCategory)) {
      process.stderr.write(
        `cc-use: '${cat}' is not a safe category. Did you mean --include-risky?\n`,
      );
      return 1;
    }
  }

  for (const cat of opts.includeRisky) {
    if (!RISKY_CATEGORIES.includes(cat as RiskyCategory)) {
      process.stderr.write(`cc-use: unknown risky category '${cat}'.\n`);
      return 1;
    }
  }

  for (const cat of opts.exclude) {
    if (!SAFE_CATEGORIES.includes(cat as SafeCategory)) {
      process.stderr.write(`cc-use: cannot exclude unknown category '${cat}'.\n`);
      return 1;
    }
  }

  // Determine active safe categories
  let activeSafe: SafeCategory[];
  if (opts.all) {
    activeSafe = [...SAFE_CATEGORIES];
  } else if (opts.include.length > 0) {
    activeSafe = [...opts.include];
  } else {
    activeSafe = [...DEFAULT_SAFE_CATEGORIES];
  }
  activeSafe = activeSafe.filter((c) => !opts.exclude.includes(c));

  const activeRisky: RiskyCategory[] = [...opts.includeRisky];

  // If settings-raw is requested, settings-safe would target the same file.
  // Remove settings-safe from the safe set to avoid a nonsensical overlap.
  if (activeSafe.includes('settings-safe') && activeRisky.includes('settings-raw')) {
    activeSafe = activeSafe.filter((c) => c !== 'settings-safe');
  }

  const nativeDir = opts.nativeClaudeDir ?? NATIVE_CLAUDE_DIR;
  const targetDir = sessionDirFor(opts.profile);

  const plan = buildPlan(nativeDir, targetDir, activeSafe, activeRisky);

  // Detect duplicate targets within the plan
  const dstSet = new Set<string>();
  for (const item of plan.toCopy) {
    if (dstSet.has(item.dst)) {
      process.stderr.write(
        `cc-use: duplicate target in plan: '${item.dst}'.\n`,
      );
      return 1;
    }
    dstSet.add(item.dst);
  }

  if (opts.dryRun) {
    renderDryRun(nativeDir, targetDir, plan);
    return plan.conflicts.length > 0 && !opts.force ? 1 : 0;
  }

  // Execute
  let copiedFiles = 0;
  let copiedDirs = 0;
  let skippedSymlinks = 0;
  let sanitizedFiles = 0;

  for (const item of plan.toCopy) {
    if (item.conflict && !opts.force && item.type !== 'dir') {
      // Files are skipped on conflict. Directories are still traversed so
      // missing nested files can be copied incrementally.
      continue;
    }

    if (item.type === 'file') {
      const dstDir = join(item.dst, '..');
      if (!existsSync(dstDir)) {
        mkdirSync(dstDir, { recursive: true });
      }

      if (item.category === 'settings-safe') {
        copySettingsSafe(item.src, item.dst, item.skippedKeys ?? []);
      } else {
        copyFileSync(item.src, item.dst);
      }
      copiedFiles++;

      if (
        item.category === 'projects' &&
        opts.sanitizeHistory &&
        item.dst.endsWith('.jsonl')
      ) {
        if (sanitizeTranscriptFile(item.dst)) {
          sanitizedFiles++;
        }
      }
    } else if (item.type === 'dir') {
      const result = copyDirRecursive(
        item.src,
        item.dst,
        item.category,
        opts.force,
        opts.sanitizeHistory,
      );
      copiedFiles += result.files;
      copiedDirs += result.dirs;
      skippedSymlinks += result.symlinks;
      sanitizedFiles += result.sanitized;
      // Count the top-level dir itself if we created it
      if (!existsSync(item.dst) || opts.force) {
        copiedDirs++;
      }
    }
  }

  // Build summary
  const lines: string[] = [
    `cc-use: imported context for '${opts.profile}'`,
  ];
  if (copiedFiles > 0) lines.push(`${copiedFiles} file(s) copied`);
  if (copiedDirs > 0) lines.push(`${copiedDirs} dir(s) copied`);
  if (sanitizedFiles > 0) lines.push(`${sanitizedFiles} transcript(s) sanitized`);
  if (skippedSymlinks > 0) lines.push(`${skippedSymlinks} symlink(s) skipped`);
  if (plan.conflicts.length > 0 && !opts.force) {
    lines.push(
      `${plan.conflicts.length} conflict(s) skipped (use --force to overwrite)`,
    );
  }
  lines.push(`target: ${targetDir}`);
  process.stdout.write(lines.join('\n        ') + '\n');

  if (plan.conflicts.length > 0 && !opts.force) {
    // Directory conflicts are handled incrementally (missing nested files are
    // still copied). Only file-level conflicts should cause non-zero exit.
    const fileConflicts = plan.conflicts.filter((c) => c.type !== 'dir');
    if (fileConflicts.length > 0) {
      return 1;
    }
  }
  return 0;
}

function buildPlan(
  nativeDir: string,
  targetDir: string,
  safeCats: SafeCategory[],
  riskyCats: RiskyCategory[],
): Plan {
  const toCopy: PlanItem[] = [];
  const skipped: { category: Category; reason: string }[] = [];
  const conflicts: PlanItem[] = [];

  const add = (
    category: Category,
    src: string,
    dst: string,
    type: 'file' | 'dir',
    skippedKeys?: string[],
  ) => {
    const conflict = existsSync(dst);
    const item: PlanItem = { category, src, dst, type, conflict, skippedKeys };
    if (conflict) conflicts.push(item);
    toCopy.push(item);
  };

  for (const cat of safeCats) {
    switch (cat) {
      case 'projects': {
        const srcProjects = join(nativeDir, 'projects');
        if (!isRealDirectory(srcProjects)) {
          skipped.push({ category: 'projects', reason: 'source not found' });
          break;
        }
        let hasEntries = false;
        for (const entry of readdirSync(srcProjects)) {
          const src = join(srcProjects, entry);
          const stat = lstatSync(src);
          if (stat.isSymbolicLink()) {
            skipped.push({
              category: 'projects',
              reason: `symlink skipped: ${entry}`,
            });
            continue;
          }
          if (!stat.isDirectory()) continue;
          hasEntries = true;
          const dst = join(targetDir, 'projects', entry);
          add('projects', src, dst, 'dir');
        }
        if (!hasEntries) {
          skipped.push({
            category: 'projects',
            reason: 'no project directories found',
          });
        }
        break;
      }
      case 'settings-safe': {
        const src = join(nativeDir, 'settings.json');
        if (isSymlink(src)) {
          skipped.push({
            category: 'settings-safe',
            reason: 'symlink skipped: settings.json',
          });
          break;
        }
        if (!isRealFile(src)) {
          skipped.push({
            category: 'settings-safe',
            reason: 'settings.json not found',
          });
          break;
        }
        let skippedKeys: string[];
        try {
          const data = JSON.parse(readFileSync(src, 'utf8')) as Record<string, unknown>;
          skippedKeys = Object.keys(data).filter((k) => !SETTINGS_SAFE_ALLOWLIST.has(k));
        } catch {
          skipped.push({
            category: 'settings-safe',
            reason: 'settings.json is not valid JSON',
          });
          break;
        }
        const dst = join(targetDir, 'settings.json');
        add('settings-safe', src, dst, 'file', skippedKeys);
        break;
      }
      case 'agents': {
        const src = join(nativeDir, 'agents');
        if (!isRealDirectory(src)) {
          skipped.push({ category: 'agents', reason: 'source not found' });
          break;
        }
        const dst = join(targetDir, 'agents');
        add('agents', src, dst, 'dir');
        break;
      }
      case 'skills': {
        const src = join(nativeDir, 'skills');
        if (!isRealDirectory(src)) {
          skipped.push({ category: 'skills', reason: 'source not found' });
          break;
        }
        const dst = join(targetDir, 'skills');
        add('skills', src, dst, 'dir');
        break;
      }
      case 'commands': {
        const src = join(nativeDir, 'commands');
        if (!isRealDirectory(src)) {
          skipped.push({ category: 'commands', reason: 'source not found' });
          break;
        }
        const dst = join(targetDir, 'commands');
        add('commands', src, dst, 'dir');
        break;
      }
    }
  }

  for (const cat of riskyCats) {
    switch (cat) {
      case 'settings-raw': {
        const src = join(nativeDir, 'settings.json');
        if (isSymlink(src)) {
          skipped.push({
            category: 'settings-raw',
            reason: 'symlink skipped: settings.json',
          });
          break;
        }
        if (!isRealFile(src)) {
          skipped.push({
            category: 'settings-raw',
            reason: 'settings.json not found',
          });
          break;
        }
        const dst = join(targetDir, 'settings.json');
        add('settings-raw', src, dst, 'file');
        break;
      }
      case 'mcp': {
        const srcFile = join(nativeDir, 'mcp.json');
        const srcDir = join(nativeDir, 'mcp');
        let found = false;
        if (isSymlink(srcFile)) {
          skipped.push({ category: 'mcp', reason: 'symlink skipped: mcp.json' });
        } else if (isRealFile(srcFile)) {
          add('mcp', srcFile, join(targetDir, 'mcp.json'), 'file');
          found = true;
        }
        if (isSymlink(srcDir)) {
          skipped.push({ category: 'mcp', reason: 'symlink skipped: mcp' });
        } else if (isRealDirectory(srcDir)) {
          add('mcp', srcDir, join(targetDir, 'mcp'), 'dir');
          found = true;
        }
        if (!found) {
          skipped.push({ category: 'mcp', reason: 'source not found' });
        }
        break;
      }
      case 'hooks': {
        const srcDir = join(nativeDir, 'hooks');
        const srcFile = join(nativeDir, 'hooks.json');
        let found = false;
        if (isSymlink(srcDir)) {
          skipped.push({ category: 'hooks', reason: 'symlink skipped: hooks' });
        } else if (isRealDirectory(srcDir)) {
          add('hooks', srcDir, join(targetDir, 'hooks'), 'dir');
          found = true;
        }
        if (isSymlink(srcFile)) {
          skipped.push({ category: 'hooks', reason: 'symlink skipped: hooks.json' });
        } else if (isRealFile(srcFile)) {
          add('hooks', srcFile, join(targetDir, 'hooks.json'), 'file');
          found = true;
        }
        if (!found) {
          skipped.push({ category: 'hooks', reason: 'source not found' });
        }
        break;
      }
      case 'plugins': {
        const src = join(nativeDir, 'plugins');
        if (!isRealDirectory(src)) {
          skipped.push({ category: 'plugins', reason: 'source not found' });
          break;
        }
        add('plugins', src, join(targetDir, 'plugins'), 'dir');
        break;
      }
    }
  }

  return { toCopy, skipped, conflicts };
}

function isRealDirectory(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isRealFile(p: string): boolean {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function copyDirRecursive(
  src: string,
  dst: string,
  category: Category,
  force: boolean,
  sanitizeHistory: boolean,
): {
  files: number;
  dirs: number;
  symlinks: number;
  sanitized: number;
} {
  let files = 0;
  let dirs = 0;
  let symlinks = 0;
  let sanitized = 0;

  // Defensive: if src itself is a symlink, do not follow.
  try {
    if (lstatSync(src).isSymbolicLink()) {
      return { files: 0, dirs: 0, symlinks: 1, sanitized: 0 };
    }
  } catch {
    return { files: 0, dirs: 0, symlinks: 0, sanitized: 0 };
  }

  mkdirSync(dst, { recursive: true });

  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const stat = lstatSync(s);

    if (stat.isSymbolicLink()) {
      symlinks++;
      continue;
    }

    if (stat.isDirectory()) {
      const nested = copyDirRecursive(s, d, category, force, sanitizeHistory);
      files += nested.files;
      dirs += nested.dirs;
      symlinks += nested.symlinks;
      sanitized += nested.sanitized;
      dirs++;
    } else if (stat.isFile()) {
      if (existsSync(d) && !force) {
        continue;
      }
      copyFileSync(s, d);
      files++;
      if (
        category === 'projects' &&
        sanitizeHistory &&
        d.endsWith('.jsonl')
      ) {
        if (sanitizeTranscriptFile(d)) {
          sanitized++;
        }
      }
    }
  }

  return { files, dirs, symlinks, sanitized };
}

function copySettingsSafe(
  src: string,
  dst: string,
  _skippedKeys: string[],
): void {
  const data = JSON.parse(readFileSync(src, 'utf8')) as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (SETTINGS_SAFE_ALLOWLIST.has(key)) {
      safe[key] = data[key];
    }
  }
  writeFileSync(dst, JSON.stringify(safe, null, 2) + '\n', { mode: 0o600 });
}

function renderDryRun(
  nativeDir: string,
  targetDir: string,
  plan: Plan,
): void {
  process.stdout.write(`Source: ${nativeDir}\n`);
  process.stdout.write(`Target: ${targetDir}\n\n`);

  if (plan.toCopy.length > 0) {
    process.stdout.write(`Will copy:\n`);
    for (const item of plan.toCopy) {
      const conflict = item.conflict ? ' (conflict)' : '';
      const keys =
        item.skippedKeys && item.skippedKeys.length > 0
          ? ` [skipped keys: ${item.skippedKeys.join(', ')}]`
          : '';
      process.stdout.write(
        `  ${item.category.padEnd(12)} ${item.src} -> ${item.dst}${conflict}${keys}\n`,
      );
    }
  } else {
    process.stdout.write(`Will copy: (nothing)\n`);
  }

  if (plan.skipped.length > 0) {
    process.stdout.write(`\nSkipped:\n`);
    for (const s of plan.skipped) {
      process.stdout.write(`  ${s.category.padEnd(12)} ${s.reason}\n`);
    }
  }

  if (plan.conflicts.length > 0) {
    process.stdout.write(`\nConflicts:\n`);
    for (const c of plan.conflicts) {
      process.stdout.write(
        `  ${c.category.padEnd(12)} target exists, use --force to overwrite\n`,
      );
    }
  }
}

export async function syncProfileContext(
  profileName: string,
  opts?: { nativeClaudeDir?: string; sanitizeHistory?: boolean },
): Promise<void> {
  try {
    const code = await runImportContext({
      profile: profileName,
      dryRun: false,
      force: false,
      include: [],
      exclude: [],
      includeRisky: [],
      all: false,
      sanitizeHistory: opts?.sanitizeHistory ?? false,
      nativeClaudeDir: opts?.nativeClaudeDir,
    });
    // Code 1 means conflicts were skipped, which is expected for non-destructive
    // launch-time sync. Only log unexpected non-zero codes.
    if (code !== 0 && code !== 1) {
      process.stderr.write(
        `cc-use: context sync exited with code ${code} for '${profileName}'.\n`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `cc-use: context sync warning for '${profileName}': ${msg}\n`,
    );
  }
}
