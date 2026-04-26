import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { PROVIDERS_DIR, profilePath } from './paths.js';
import { isReserved, profileExists, validateProfileName } from './profile.js';
import { listTemplates, loadTemplate, type TemplateMeta } from './templates.js';
import { ask, askHidden, askYesNo } from './wizard.js';
import { getDefaultProfile, setDefaultProfile } from './config.js';
import { runDoctor } from './doctor.js';

export interface InitOptions {
  template?: string;
  name?: string;
  token?: string;
  nonInteractive?: boolean;
  force?: boolean;
  setDefault?: boolean;
  skipProbe?: boolean;
}

export async function runInit(opts: InitOptions): Promise<number> {
  const tpl = await pickTemplate(opts);
  const profileName = await pickName(tpl, opts);

  if (!opts.force && profileExists(profileName)) {
    process.stderr.write(
      `cc-use: profile '${profileName}' already exists. Use --force to overwrite, or pick another name.\n`,
    );
    return 1;
  }

  const env: Record<string, string> = { ...tpl.defaults };

  if (!env.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL.startsWith('<')) {
    if (opts.nonInteractive) {
      process.stderr.write(
        `cc-use: template '${tpl.name}' has no default ANTHROPIC_BASE_URL. Pass it via env or fill the template manually.\n`,
      );
      return 1;
    }
    const url = await ask('ANTHROPIC_BASE_URL:');
    if (!url) {
      process.stderr.write('cc-use: ANTHROPIC_BASE_URL is required.\n');
      return 1;
    }
    env.ANTHROPIC_BASE_URL = url;
  }

  let token = opts.token ?? '';
  if (!token) {
    if (opts.nonInteractive) {
      process.stderr.write('cc-use: --token is required in non-interactive mode.\n');
      return 1;
    }
    token = await askHidden('API key (input hidden):');
    if (!token) {
      process.stderr.write('cc-use: API key is required.\n');
      return 1;
    }
  }
  env.ANTHROPIC_AUTH_TOKEN = token;

  if (!opts.nonInteractive && env.ANTHROPIC_MODEL) {
    const newModel = await ask(`ANTHROPIC_MODEL:`, env.ANTHROPIC_MODEL);
    env.ANTHROPIC_MODEL = newModel;
  }

  if (!existsSync(PROVIDERS_DIR)) mkdirSync(PROVIDERS_DIR, { recursive: true });
  const target = profilePath(profileName);
  const ordered = orderEnvForFile(env);
  writeFileSync(target, JSON.stringify(ordered, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(`\ncc-use: wrote ${target}\n`);

  let didSetDefault = false;
  if (opts.setDefault === true) {
    setDefaultProfile(profileName);
    didSetDefault = true;
  } else if (opts.setDefault === undefined && !opts.nonInteractive) {
    const currentDefault = getDefaultProfile();
    if (!currentDefault) {
      const yes = await askYesNo(`Set '${profileName}' as default?`);
      if (yes) {
        setDefaultProfile(profileName);
        didSetDefault = true;
      }
    }
  }
  if (didSetDefault) {
    process.stdout.write(`cc-use: default profile set to '${profileName}'.\n`);
  }

  if (!opts.skipProbe) {
    process.stdout.write(
      `\ncc-use: running doctor (this sends one tiny request to verify your endpoint, ~1 token)...\n`,
    );
    await runDoctor({ profile: profileName, probe: true });
  }

  process.stdout.write(`\nDone. Try:\n  cc-use ${profileName}\n`);
  if (didSetDefault) {
    process.stdout.write(`  cc-use            (uses '${profileName}' since it's now default)\n`);
  }
  return 0;
}

async function pickTemplate(opts: InitOptions): Promise<TemplateMeta> {
  const all = listTemplates();
  if (opts.template) {
    return loadTemplate(opts.template);
  }
  if (opts.nonInteractive) {
    throw new Error(`--template is required in non-interactive mode. Available: ${all.join(', ')}`);
  }
  process.stdout.write('\nAvailable templates:\n');
  for (let i = 0; i < all.length; i++) {
    const meta = loadTemplate(all[i]!);
    process.stdout.write(`  ${i + 1}. ${meta.name.padEnd(12)} ${meta.description}\n`);
  }
  while (true) {
    const answer = await ask(`\nPick a template (1-${all.length} or name):`);
    const asNum = Number.parseInt(answer, 10);
    if (Number.isInteger(asNum) && asNum >= 1 && asNum <= all.length) {
      return loadTemplate(all[asNum - 1]!);
    }
    if (all.includes(answer)) {
      return loadTemplate(answer);
    }
    process.stderr.write(`cc-use: invalid choice '${answer}'. Try again.\n`);
  }
}

async function pickName(tpl: TemplateMeta, opts: InitOptions): Promise<string> {
  let candidate = opts.name ?? tpl.name;
  if (opts.nonInteractive) {
    validateProfileName(candidate);
    return candidate;
  }
  while (true) {
    const answer = await ask('Profile name:', candidate);
    candidate = answer || candidate;
    if (isReserved(candidate)) {
      process.stderr.write(`cc-use: '${candidate}' is reserved. Pick another.\n`);
      continue;
    }
    try {
      validateProfileName(candidate);
      return candidate;
    } catch (e) {
      process.stderr.write(`cc-use: ${(e as Error).message}\n`);
    }
  }
}

function orderEnvForFile(env: Record<string, string>): Record<string, string> {
  const preferred = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
    'CLAUDE_CODE_EFFORT_LEVEL',
  ];
  const out: Record<string, string> = {};
  for (const k of preferred) if (env[k] !== undefined) out[k] = env[k]!;
  for (const [k, v] of Object.entries(env)) if (out[k] === undefined) out[k] = v;
  return out;
}
