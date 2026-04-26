import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NATIVE_CLAUDE_DIR, sessionDirFor } from './paths.js';
import { profileExists } from './profile.js';

export interface ImportOptions {
  profile: string;
  all: boolean;
}

export async function runImportHistory(opts: ImportOptions): Promise<number> {
  if (!profileExists(opts.profile)) {
    process.stderr.write(`cc-use: profile '${opts.profile}' not found.\n`);
    return 1;
  }

  const nativeProjects = join(NATIVE_CLAUDE_DIR, 'projects');
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

  if (opts.all) {
    for (const entry of readdirSync(nativeProjects)) {
      const src = join(nativeProjects, entry);
      if (!statSync(src).isDirectory()) continue;
      copied += copyDir(src, join(targetProjects, entry));
      dirs++;
    }
  } else {
    const cwdHash = encodeCwdToProjectFolder(process.cwd());
    const candidate = join(nativeProjects, cwdHash);
    if (!existsSync(candidate)) {
      process.stderr.write(
        `cc-use: no native history for current cwd (${process.cwd()}).\n` +
          `        Looked for: ${candidate}\n` +
          `        Use --all to import every project.\n`,
      );
      return 1;
    }
    copied = copyDir(candidate, join(targetProjects, cwdHash));
    dirs = 1;
  }

  process.stdout.write(
    `cc-use: imported ${copied} file(s) across ${dirs} project dir(s) into\n` +
      `        ${targetProjects}\n` +
      `        ~/.claude/ untouched.\n`,
  );
  return 0;
}

function copyDir(src: string, dst: string): number {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const stat = statSync(s);
    if (stat.isDirectory()) {
      n += copyDir(s, d);
    } else if (stat.isFile()) {
      copyFileSync(s, d);
      n++;
    }
  }
  return n;
}

// Claude Code encodes cwd as project folder by replacing path separators with dashes
// e.g. /Users/foo/work → -Users-foo-work
function encodeCwdToProjectFolder(cwd: string): string {
  return cwd.replace(/[\\/]/g, '-');
}
