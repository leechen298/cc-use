#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnClaude } from './exec.js';
import {
  findPlaceholders,
  listProfiles,
  loadProfile,
  profileExists,
  validateProfileName,
  type Profile,
} from './profile.js';
import { getDefaultProfile, setDefaultProfile } from './config.js';
import { runInit } from './init.js';
import { runDoctor, runDoctorAll } from './doctor.js';
import { runImportHistory } from './importHistory.js';
import { runImportContext, syncProfileContext } from './importContext.js';
import { runRemove } from './remove.js';
import { selectAutoProfile } from './auto.js';
import { runStatus } from './status.js';
import { listTemplates } from './templates.js';
import { USAGE } from './help.js';
import { sessionDirFor, NATIVE_CLAUDE_DIR } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`cc-use: ${msg}\n`);
  process.exit(1);
});

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    process.exit(await launchDefault([], { prefix: 'cc-use', isolated: false }));
  }

  const head = argv[0]!;
  const rest = argv.slice(1);

  if (head === '--version' || head === '-v' || head === 'version') {
    printVersion();
    return;
  }
  if (head === '--help' || head === '-h' || head === 'help') {
    process.stdout.write(USAGE);
    return;
  }

  // '--' explicit pass-through
  if (head === '--') {
    process.exit(await launchDefault(rest, { prefix: 'cc-use', isolated: false }));
  }

  // First arg starts with '-' → treat full argv as claude args, use default
  if (head.startsWith('-')) {
    process.exit(await launchDefault(argv, { prefix: 'cc-use', isolated: false }));
  }

  switch (head) {
    case 'init':
      process.exit(await runInit(parseInitArgs(rest)));
    case 'ls':
    case 'list':
      printLs();
      return;
    case 'doctor': {
      const parsed = parseDoctorArgs(rest);
      if (parsed.all) {
        process.exit(await runDoctorAll({ probe: parsed.probe }));
      }
      process.exit(await runDoctor({ profile: parsed.profile!, probe: parsed.probe }));
    }
    case 'default':
      handleDefault(rest);
      return;
    case 'import-history':
      process.exit(await runImportHistory(parseImportArgs(rest)));
    case 'import-context':
      process.exit(await runImportContext(parseImportContextArgs(rest)));
    case 'remove':
      process.exit(await runRemove(parseRemoveArgs(rest)));
    case 'status':
      process.exit(runStatus());
    case 'auto':
      process.exit(await launchAuto(stripLeadingDoubleDash(rest), true));
    case 'with':
      process.exit(await launchWithProfile(rest));
    case 'isolate':
      process.exit(await launchIsolated(rest));
    default:
      // Unknown head: treat as profile name
      process.exit(await launchByName(head, rest));
  }
}

async function resolveLaunchProfile(name: string): Promise<Profile | number> {
  if (profileExists(name)) {
    const profile = loadProfile(name);
    const missing = findPlaceholders(profile.env);
    if (missing.length > 0) {
      if (!process.stdin.isTTY) {
        process.stderr.write(
          `cc-use: profile '${name}' has unfilled placeholders (${missing.join(', ')}).\n` +
            `        Run 'cc-use init ${name} --force' to reconfigure.\n`,
        );
        return 1;
      }
      process.stdout.write(
        `\ncc-use: profile '${name}' looks unfinished (placeholder values in ${missing.join(', ')}).\n` +
          `Reconfiguring now...\n\n`,
      );
      const initCode = await runInit({ template: name, name, force: true });
      if (initCode !== 0) return initCode;
      return loadProfile(name);
    }
    return profile;
  }

  if (listTemplates().includes(name)) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `cc-use: profile '${name}' not configured. Run 'cc-use init ${name}' first.\n`,
      );
      return 1;
    }
    process.stdout.write(`\ncc-use: profile '${name}' not configured yet. Setting it up...\n\n`);
    const initCode = await runInit({ template: name, name });
    if (initCode !== 0) return initCode;
    return loadProfile(name);
  }

  process.stderr.write(
    `cc-use: '${name}' is not a profile, template, or known subcommand.\n` +
      `        Run 'cc-use ls' to see profiles, 'cc-use init' to set one up, or 'cc-use --help'.\n`,
  );
  return 1;
}

async function launchByName(name: string, passThroughArgs: string[]): Promise<number> {
  const resolved = await resolveLaunchProfile(name);
  if (typeof resolved === 'number') return resolved;
  return spawnClaude(resolved, passThroughArgs, { claudeConfigDir: NATIVE_CLAUDE_DIR });
}

async function launchWithProfile(args: string[]): Promise<number> {
  const head = args[0];
  const rest = args.slice(1);

  if (head === '--') {
    return await launchDefault(rest, { prefix: 'cc-use with', isolated: false });
  }

  if (!head || head.startsWith('-')) {
    return await launchDefault(args, { prefix: 'cc-use with', isolated: false });
  }

  if (head === 'auto') {
    return await launchAuto(stripLeadingDoubleDash(rest), true);
  }

  return await launchByName(head, rest);
}

async function launchAuto(passThroughArgs: string[], sharedContext: boolean): Promise<number> {
  const selected = await selectAutoProfile();
  if (typeof selected === 'number') return selected;
  const resolved = await resolveLaunchProfile(selected);
  if (typeof resolved === 'number') return resolved;
  if (!sharedContext) {
    await syncProfileContext(resolved.name);
  }
  return spawnClaude(resolved, passThroughArgs, {
    claudeConfigDir: sharedContext ? NATIVE_CLAUDE_DIR : sessionDirFor(resolved.name),
  });
}

async function launchIsolated(args: string[]): Promise<number> {
  const head = args[0];
  const rest = args.slice(1);

  if (head === '--') {
    return await launchDefault(rest, { prefix: 'cc-use isolate', isolated: true });
  }

  if (!head || head.startsWith('-')) {
    return await launchDefault(args, { prefix: 'cc-use isolate', isolated: true });
  }

  if (head === 'auto') {
    return await launchAuto(stripLeadingDoubleDash(rest), false);
  }

  const resolved = await resolveLaunchProfile(head);
  if (typeof resolved === 'number') return resolved;
  await syncProfileContext(resolved.name);
  return spawnClaude(resolved, rest, { claudeConfigDir: sessionDirFor(resolved.name) });
}

function stripLeadingDoubleDash(args: string[]): string[] {
  return args[0] === '--' ? args.slice(1) : args;
}

async function launchDefault(
  passThroughArgs: string[],
  opts: { prefix: string; isolated: boolean },
): Promise<number> {
  const def = getDefaultProfile();
  if (!def) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `${opts.prefix}: no default profile set. Run 'cc-use default <profile>' or 'cc-use init'.\n`,
      );
      return 1;
    }
    await chooseDefaultOrInit(passThroughArgs, { isolated: opts.isolated });
    return 0; // unreachable; chooseDefaultOrInit exits
  }

  if (!profileExists(def)) {
    const fromEnv = !!process.env.CC_USE_DEFAULT;
    if (!process.stdin.isTTY) {
      if (fromEnv) {
        process.stderr.write(
          `${opts.prefix}: CC_USE_DEFAULT points to '${def}' but that profile does not exist. ` +
            `Unset CC_USE_DEFAULT or create the profile.\n`,
        );
      } else {
        process.stderr.write(
          `${opts.prefix}: default profile '${def}' not found. Run 'cc-use default <name>' or 'cc-use init'.\n`,
        );
      }
      return 1;
    }
    // TTY: handle broken default
    if (fromEnv) {
      process.stderr.write(
        `${opts.prefix}: warning: CC_USE_DEFAULT points to '${def}' but that profile does not exist. ` +
          `Unset or update the environment variable.\n`,
      );
    } else {
      setDefaultProfile(undefined);
      process.stdout.write(`${opts.prefix}: configured default '${def}' no longer exists; unset.\n`);
    }
    await chooseDefaultOrInit(passThroughArgs, { isolated: opts.isolated });
    return 0; // unreachable
  }

  const profile = loadProfile(def);
  const missing = findPlaceholders(profile.env);
  if (missing.length > 0) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `${opts.prefix}: default profile '${def}' has unfilled placeholders (${missing.join(', ')}).\n` +
          `        Run 'cc-use init ${def} --force' to reconfigure.\n`,
      );
      return 1;
    }
    process.stdout.write(
      `\n${opts.prefix}: default profile '${def}' looks unfinished (placeholder values in ${missing.join(', ')}).\n` +
        `Reconfiguring now...\n\n`,
    );
    const initCode = await runInit({ template: def, name: def, force: true });
    if (initCode !== 0) return initCode;
    const updated = loadProfile(def);
    if (opts.isolated) {
      await syncProfileContext(def);
    }
    return spawnClaude(updated, passThroughArgs, {
      claudeConfigDir: opts.isolated ? sessionDirFor(def) : NATIVE_CLAUDE_DIR,
    });
  }

  if (opts.isolated) {
    await syncProfileContext(def);
  }
  return spawnClaude(profile, passThroughArgs, {
    claudeConfigDir: opts.isolated ? sessionDirFor(def) : NATIVE_CLAUDE_DIR,
  });
}

async function chooseDefaultOrInit(
  passThroughArgs: string[],
  opts?: { isolated?: boolean },
): Promise<void> {
  const profiles = listProfiles();
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `cc-use: no default profile set. Run 'cc-use default <profile>' or 'cc-use init'.\n`,
    );
    process.exit(1);
  }
  if (profiles.length === 0) {
    process.stdout.write(
      `\nWelcome to cc-use! No profile configured yet.\n` +
        `Let's set one up — you'll need an API key for your chosen provider.\n\n`,
    );
    process.exit(await runInit({}));
  }
  // TTY picker
  const { pickOption } = await import('./wizard.js');
  const items = [
    ...profiles.map((p) => ({ label: p.name })),
    { label: 'Create a new profile' },
  ];
  const idx = await pickOption('Choose a profile to launch:', items);
  if (idx === profiles.length) {
    // "Create a new profile"
    process.exit(await runInit({}));
  }
  const chosen = profiles[idx]!.name;
  setDefaultProfile(chosen);
  process.stdout.write(`cc-use: default profile set to '${chosen}'.\n`);
  if (opts?.isolated) {
    await syncProfileContext(chosen);
  }
  const code = await spawnClaude(loadProfile(chosen), passThroughArgs, {
    claudeConfigDir: opts?.isolated ? sessionDirFor(chosen) : NATIVE_CLAUDE_DIR,
  });
  process.exit(code);
}

function printVersion(): void {
  const pkgPath = join(__dirname, '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    process.stdout.write(`${pkg.version ?? 'unknown'}\n`);
  } catch {
    process.stdout.write(`unknown\n`);
  }
}

function printLs(): void {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    process.stderr.write(`(no profiles configured — run 'cc-use init')\n`);
    return;
  }
  const def = getDefaultProfile();
  for (const p of profiles) {
    const marker = p.name === def ? '*' : ' ';
    process.stdout.write(`${marker} ${p.name}\n`);
  }
}

function handleDefault(args: string[]): void {
  if (args.length === 0) {
    const def = getDefaultProfile();
    if (def) process.stdout.write(`${def}\n`);
    else process.stdout.write(`(no default set)\n`);
    return;
  }
  const sub = args[0]!;
  if (sub === '--unset' || sub === 'unset') {
    setDefaultProfile(undefined);
    process.stdout.write(`cc-use: default unset.\n`);
    return;
  }
  validateProfileName(sub);
  if (!profileExists(sub)) {
    process.stderr.write(
      `cc-use: profile '${sub}' not found. Run 'cc-use ls' or 'cc-use init ${sub}'.\n`,
    );
    process.exit(1);
  }
  setDefaultProfile(sub);
  process.stdout.write(`cc-use: default profile set to '${sub}'.\n`);
}

function parseInitArgs(args: string[]): {
  template?: string;
  name?: string;
  token?: string;
  nonInteractive?: boolean;
  force?: boolean;
  setDefault?: boolean;
  skipProbe?: boolean;
} {
  const out: ReturnType<typeof parseInitArgs> = {};
  let positional = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case '--non-interactive':
      case '--no-interactive':
        out.nonInteractive = true;
        break;
      case '--force':
      case '-f':
        out.force = true;
        break;
      case '--set-default':
        out.setDefault = true;
        break;
      case '--no-set-default':
        out.setDefault = false;
        break;
      case '--no-probe':
        out.skipProbe = true;
        break;
      case '--token':
        out.token = args[++i];
        break;
      case '--name':
        out.name = args[++i];
        break;
      default:
        if (a.startsWith('-')) {
          process.stderr.write(`cc-use init: unknown flag '${a}'\n`);
          process.exit(1);
        }
        if (positional === 0) {
          out.template = a;
          positional++;
        } else {
          process.stderr.write(`cc-use init: unexpected argument '${a}'\n`);
          process.exit(1);
        }
    }
  }
  return out;
}

function parseDoctorArgs(args: string[]): { profile?: string; all: boolean; probe: boolean } {
  let profile: string | undefined;
  let probe = true;
  let all = false;
  for (const a of args) {
    if (a === '--no-probe') probe = false;
    else if (a === '--all') all = true;
    else if (a.startsWith('-')) {
      process.stderr.write(`cc-use doctor: unknown flag '${a}'\n`);
      process.exit(1);
    } else if (!profile) profile = a;
    else {
      process.stderr.write(`cc-use doctor: unexpected argument '${a}'\n`);
      process.exit(1);
    }
  }
  if (all && profile) {
    process.stderr.write(`cc-use doctor: cannot combine --all with a profile name.\n`);
    process.exit(1);
  }
  if (!all && !profile) {
    profile = getDefaultProfile();
    if (!profile) {
      process.stderr.write(`cc-use doctor: profile name required (no default set), or use --all.\n`);
      process.exit(1);
    }
  }
  return { profile, all, probe };
}

function parseRemoveArgs(args: string[]): { profile: string; yes: boolean; deleteSession: boolean } {
  let profile: string | undefined;
  let yes = false;
  let deleteSession = false;
  for (const a of args) {
    if (a === '--yes' || a === '-y') yes = true;
    else if (a === '--delete-session') deleteSession = true;
    else if (a.startsWith('-')) {
      process.stderr.write(`cc-use remove: unknown flag '${a}'\n`);
      process.exit(1);
    } else if (!profile) profile = a;
    else {
      process.stderr.write(`cc-use remove: unexpected argument '${a}'\n`);
      process.exit(1);
    }
  }
  if (!profile) {
    process.stderr.write(`cc-use remove: profile name required.\n`);
    process.exit(1);
  }
  return { profile, yes, deleteSession };
}

function parseImportArgs(args: string[]): { profile: string; all: boolean; sanitize: boolean } {
  let profile: string | undefined;
  let all = false;
  let sanitize = false;
  for (const a of args) {
    if (a === '--all') all = true;
    else if (a === '--sanitize') sanitize = true;
    else if (a === '--raw') sanitize = false;
    else if (a.startsWith('-')) {
      process.stderr.write(`cc-use import-history: unknown flag '${a}'\n`);
      process.exit(1);
    } else if (!profile) profile = a;
    else {
      process.stderr.write(`cc-use import-history: unexpected argument '${a}'\n`);
      process.exit(1);
    }
  }
  if (!profile) {
    profile = getDefaultProfile();
    if (!profile) {
      process.stderr.write(`cc-use import-history: profile name required.\n`);
      process.exit(1);
    }
  }
  return { profile, all, sanitize };
}

function parseImportContextArgs(args: string[]): {
  profile: string;
  dryRun: boolean;
  force: boolean;
  include: import('./importContext.js').SafeCategory[];
  exclude: import('./importContext.js').SafeCategory[];
  includeRisky: import('./importContext.js').RiskyCategory[];
  all: boolean;
  sanitizeHistory: boolean;
} {
  let profile: string | undefined;
  let dryRun = false;
  let force = false;
  let all = false;
  let sanitizeHistory = false;
  const include: string[] = [];
  const exclude: string[] = [];
  const includeRisky: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--force':
      case '-f':
        force = true;
        break;
      case '--all':
        all = true;
        break;
      case '--sanitize-history':
        sanitizeHistory = true;
        break;
      case '--include': {
        const val = args[++i];
        if (!val) {
          process.stderr.write(`cc-use import-context: --include requires a value.\n`);
          process.exit(1);
        }
        for (const c of val.split(',').map((s) => s.trim()).filter(Boolean)) {
          include.push(c);
        }
        break;
      }
      case '--exclude': {
        const val = args[++i];
        if (!val) {
          process.stderr.write(`cc-use import-context: --exclude requires a value.\n`);
          process.exit(1);
        }
        for (const c of val.split(',').map((s) => s.trim()).filter(Boolean)) {
          exclude.push(c);
        }
        break;
      }
      case '--include-risky': {
        const val = args[++i];
        if (!val) {
          process.stderr.write(`cc-use import-context: --include-risky requires a value.\n`);
          process.exit(1);
        }
        for (const c of val.split(',').map((s) => s.trim()).filter(Boolean)) {
          includeRisky.push(c);
        }
        break;
      }
      default:
        if (a.startsWith('-')) {
          process.stderr.write(`cc-use import-context: unknown flag '${a}'\n`);
          process.exit(1);
        }
        if (!profile) {
          profile = a;
        } else {
          process.stderr.write(`cc-use import-context: unexpected argument '${a}'\n`);
          process.exit(1);
        }
    }
  }

  if (!profile) {
    profile = getDefaultProfile();
    if (!profile) {
      process.stderr.write(`cc-use import-context: profile name required (no default set).\n`);
      process.exit(1);
    }
  }

  return {
    profile,
    dryRun,
    force,
    include: include as import('./importContext.js').SafeCategory[],
    exclude: exclude as import('./importContext.js').SafeCategory[],
    includeRisky: includeRisky as import('./importContext.js').RiskyCategory[],
    all,
    sanitizeHistory,
  };
}
