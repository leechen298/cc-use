import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { USAGE } from '../src/help.js';
import { isReserved } from '../src/profile.js';

const tmp = mkdtempSync(join(tmpdir(), 'cc-use-cli-test-'));
const ccUseDir = join(tmp, 'cc-use');
const nativeClaudeDir = join(tmp, '.claude');
const sessionDir = join(ccUseDir, 'sessions', 'deepseek');
const cliPath = join(process.cwd(), 'dist/cli.js');
const isWin = process.platform === 'win32';
const posixOnly = isWin ? 'fake claude script requires POSIX shell' : undefined;

test.after(() => rmSync(tmp, { recursive: true, force: true }));

// Fake claude that echoes CLAUDE_CONFIG_DIR so we can assert the split.
const binDir = join(tmp, 'bin');
mkdirSync(binDir, { recursive: true });
const fakeClaude = join(binDir, 'claude');
writeFileSync(fakeClaude, '#!/bin/sh\necho "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"\nfor arg in "$@"; do echo "ARG:$arg"; done\n');
chmodSync(fakeClaude, 0o755);

function setupProfile(name = 'deepseek', env?: Record<string, string>): void {
  const providersDir = join(ccUseDir, 'providers');
  mkdirSync(providersDir, { recursive: true });
  writeFileSync(
    join(providersDir, `${name}.json`),
    JSON.stringify(
      env ?? {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-test',
      },
    ),
  );
}

function setDefault(name: string): void {
  writeFileSync(join(ccUseDir, 'config.json'), JSON.stringify({ default: name }));
}

function run(args: string[], envOverrides?: Record<string, string>) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CC_USE_DIR: ccUseDir,
      HOME: tmp,
      PATH: `${binDir}:${process.env.PATH}`,
      ...envOverrides,
    },
  });
}

function isolatedCcUseDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('cc-use with no default profile errors in non-TTY', () => {
  const result = run(['with']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use with: no default profile set/);
});

test('cc-use with nonexistent profile errors', () => {
  const result = run(['with', 'nonexistent']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is not a profile, template, or known subcommand/);
});

test('cc-use with placeholder profile in non-TTY errors', () => {
  setupProfile('unfinished', {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: '<YOUR_KEY>',
  });
  const result = run(['with', 'unfinished']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /has unfilled placeholders/);
});

test('cc-use with <profile> sets CLAUDE_CONFIG_DIR to native ~/.claude', { skip: posixOnly }, () => {
  setupProfile();
  const result = run(['with', 'deepseek']);
  assert.equal(result.status, 0, result.stderr);
  // HOME=tmp → NATIVE_CLAUDE_DIR = tmp/.claude
  assert.ok(
    result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`),
    `expected CLAUDE_CONFIG_DIR=${nativeClaudeDir}, got: ${result.stdout}`,
  );
});

test('cc-use <profile> sets CLAUDE_CONFIG_DIR to native ~/.claude', { skip: posixOnly }, () => {
  setupProfile();
  const result = run(['deepseek']);
  assert.equal(result.status, 0, result.stderr);
  // HOME=tmp → NATIVE_CLAUDE_DIR = tmp/.claude
  assert.ok(
    result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`),
    `expected CLAUDE_CONFIG_DIR=${nativeClaudeDir}, got: ${result.stdout}`,
  );
});

test('with is a reserved subcommand name', () => {
  assert.equal(isReserved('with'), true);
});

test('isolate is a reserved subcommand name', () => {
  assert.equal(isReserved('isolate'), true);
});

test('help text includes cc-use with [profile]', () => {
  assert.match(USAGE, /cc-use with \[profile\]/);
});

test('cc-use isolate no default profile errors in non-TTY', () => {
  const result = run(['isolate']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use isolate: no default profile set/);
});

test('cc-use isolate <profile> sets CLAUDE_CONFIG_DIR to session dir', { skip: posixOnly }, () => {
  setupProfile();
  const result = run(['isolate', 'deepseek']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes(`CLAUDE_CONFIG_DIR=${sessionDir}\n`),
    `expected CLAUDE_CONFIG_DIR=${sessionDir}, got: ${result.stdout}`,
  );
});

test('--help stdout includes isolate subcommand usage', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cc-use isolate \[profile\]/);
});

test('--help stdout includes with subcommand usage', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cc-use with \[profile\]/);
});

test('--version prints package version', () => {
  const result = run(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '0.5.0');
});

test('ls reports no profiles for an empty config dir', () => {
  const dir = isolatedCcUseDir('cc-use-cli-empty-ls-');
  const result = run(['ls'], { CC_USE_DIR: dir });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /no profiles configured/);
});

test('ls lists profiles and marks configured default', () => {
  const dir = isolatedCcUseDir('cc-use-cli-ls-profiles-');
  const providersDir = join(dir, 'providers');
  mkdirSync(providersDir, { recursive: true });
  for (const name of ['deepseek', 'kimi']) {
    writeFileSync(
      join(providersDir, `${name}.json`),
      JSON.stringify({
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-test',
      }),
    );
  }
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ default: 'kimi' }));

  const result = run(['ls'], { CC_USE_DIR: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /  deepseek/);
  assert.match(result.stdout, /\* kimi/);
});

test('default command prints, sets, and unsets configured default', () => {
  setupProfile('default-target');
  let result = run(['default', 'default-target']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /default profile set to 'default-target'/);

  result = run(['default']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'default-target');

  result = run(['default', '--unset']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /default unset/);

  result = run(['default']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no default set/);
});

test('default command rejects missing profile names', () => {
  const result = run(['default', 'does-not-exist']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile 'does-not-exist' not found/);
});

test('init argument parser rejects unknown flags and extra positional args', () => {
  let result = run(['init', '--bogus']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use init: unknown flag '--bogus'/);

  result = run(['init', 'deepseek', 'extra']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use init: unexpected argument 'extra'/);
});

test('doctor argument parser rejects invalid combinations', () => {
  const emptyDir = isolatedCcUseDir('cc-use-cli-empty-doctor-');
  let result = run(['doctor'], { CC_USE_DIR: emptyDir });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile name required/);

  result = run(['doctor', '--bogus']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use doctor: unknown flag '--bogus'/);

  result = run(['doctor', 'deepseek', 'extra']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use doctor: unexpected argument 'extra'/);

  result = run(['doctor', '--all', 'deepseek']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot combine --all with a profile name/);
});

test('doctor uses configured default profile when profile is omitted', () => {
  const dir = isolatedCcUseDir('cc-use-cli-default-doctor-');
  const providersDir = join(dir, 'providers');
  mkdirSync(providersDir, { recursive: true });
  writeFileSync(
    join(providersDir, 'doctor-default.json'),
    JSON.stringify({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-test',
    }),
  );
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ default: 'doctor-default' }));

  const result = run(['doctor', '--no-probe'], { CC_USE_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile: doctor-default/);
  assert.match(result.stdout, /Skipping live probe/);
});

test('init argument parser accepts supported flags', () => {
  const dir = isolatedCcUseDir('cc-use-cli-init-flags-');
  const result = run(
    [
      'init',
      'deepseek',
      '--name',
      'init-flags-profile',
      '--token',
      'sk-test-key-1234',
      '--non-interactive',
      '--force',
      '--set-default',
      '--no-probe',
    ],
    { CC_USE_DIR: dir },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /default profile set to 'init-flags-profile'/);
  assert.equal(existsSync(join(dir, 'providers', 'init-flags-profile.json')), true);
});

test('remove and import-history argument parsers reject invalid args', () => {
  let result = run(['remove', 'one', 'two']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use remove: unexpected argument 'two'/);

  result = run(['import-history', '--bogus']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-history: unknown flag '--bogus'/);

  result = run(['import-history', 'one', 'two']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-history: unexpected argument 'two'/);

  const emptyDir = isolatedCcUseDir('cc-use-cli-empty-import-');
  result = run(['import-history'], { CC_USE_DIR: emptyDir });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-history: profile name required/);
});

test('import-context argument parser rejects invalid args', () => {
  let result = run(['import-context', '--include']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-context: --include requires a value/);

  result = run(['import-context', '--exclude']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-context: --exclude requires a value/);

  result = run(['import-context', '--include-risky']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-context: --include-risky requires a value/);

  result = run(['import-context', '--bogus']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-context: unknown flag '--bogus'/);

  result = run(['import-context', 'one', 'two']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use import-context: unexpected argument 'two'/);
});

test('import-context argument parser accepts combined include, exclude, risky, force, all, and sanitize flags', () => {
  const dir = isolatedCcUseDir('cc-use-cli-import-context-flags-');
  const home = join(dir, 'home');
  const localCcUseDir = join(dir, 'cc-use');
  const providersDir = join(localCcUseDir, 'providers');
  mkdirSync(join(home, '.claude', 'projects', 'project-a'), { recursive: true });
  mkdirSync(join(home, '.claude', 'mcp'), { recursive: true });
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  mkdirSync(providersDir, { recursive: true });
  writeFileSync(join(home, '.claude', 'projects', 'project-a', 'session.jsonl'), '{"type":"user"}\n');
  writeFileSync(
    join(providersDir, 'deepseek.json'),
    JSON.stringify({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-test',
    }),
  );

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'import-context',
      'deepseek',
      '--all',
      '--exclude',
      'settings-safe, commands',
      '--include-risky',
      'mcp, plugins',
      '--force',
      '--sanitize-history',
      '--dry-run',
    ],
    {
      env: { ...process.env, CC_USE_DIR: localCcUseDir, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /projects/);
  assert.match(result.stdout, /mcp/);
  assert.match(result.stdout, /plugins/);
  assert.doesNotMatch(result.stdout, /settings-safe/);
});

// --- remove command ---

test('remove is a reserved subcommand name', () => {
  assert.equal(isReserved('remove'), true);
});

test('auto is a reserved subcommand name', () => {
  assert.equal(isReserved('auto'), true);
});

test('status is a reserved subcommand name', () => {
  assert.equal(isReserved('status'), true);
});

test('cc-use auto selects usable default profile in shared mode', { skip: posixOnly }, () => {
  setupProfile('auto-def');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'auto-def',
      auto: {
        fallbackOrder: [],
        profiles: {
          'auto-def': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.match(result.stderr, /selected 'auto-def' \(manual_available\)/);
});

test('cc-use auto falls back when default is unusable', { skip: posixOnly }, () => {
  setupProfile('auto-no');
  setupProfile('auto-yes');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'auto-no',
      auto: {
        fallbackOrder: ['auto-yes'],
        profiles: {
          'auto-no': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: false },
          },
          'auto-yes': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.match(result.stderr, /selected 'auto-yes' \(manual_available\)/);
});

test('cc-use with auto selects usable profile in shared mode', { skip: posixOnly }, () => {
  setupProfile('auto-shared');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'auto-shared',
      auto: {
        fallbackOrder: [],
        profiles: {
          'auto-shared': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['with', 'auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.match(result.stderr, /selected 'auto-shared' \(manual_available\)/);
});

test('cc-use status prints auto profile cache state', () => {
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      auto: {
        fallbackOrder: ['status-profile'],
        profiles: {
          'status-profile': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );
  const result = run(['status']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status-profile/);
  assert.match(result.stdout, /unknown/);
});

test('cc-use auto rechecks stale usable cache before selecting', { skip: posixOnly }, () => {
  setupProfile('stale-default');
  setupProfile('stale-fallback');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'stale-default',
      auto: {
        cacheTtlSeconds: 1,
        fallbackOrder: ['stale-fallback'],
        profiles: {
          'stale-default': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: false },
          },
          'stale-fallback': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );
  writeFileSync(
    join(ccUseDir, 'status.json'),
    JSON.stringify({
      profiles: {
        'stale-default': {
          profileName: 'stale-default',
          usable: true,
          reason: 'manual_available',
          checkedAt: '2000-01-01T00:00:00.000Z',
        },
      },
    }),
  );

  const result = run(['auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.match(result.stderr, /selected 'stale-fallback'/);
});

test('cc-use auto persists check_failed for missing profile', () => {
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      auto: {
        fallbackOrder: ['missing-auto'],
        profiles: {
          'missing-auto': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );
  const result = run(['auto']);
  assert.notEqual(result.status, 0);
  const status = JSON.parse(readFileSync(join(ccUseDir, 'status.json'), 'utf-8'));
  assert.equal(status.profiles['missing-auto'].usable, false);
  assert.equal(status.profiles['missing-auto'].reason, 'check_failed');
});

test('cc-use auto skips unknown candidates and selects fallback', { skip: posixOnly }, () => {
  setupProfile('unknown-default');
  setupProfile('unknown-fallback');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'unknown-default',
      auto: {
        fallbackOrder: ['unknown-fallback'],
        profiles: {
          'unknown-fallback': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.match(result.stderr, /selected 'unknown-fallback'/);
});

test('cc-use remove without profile name errors', () => {
  const result = run(['remove']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use remove: profile name required/);
});

test('cc-use remove unknown profile errors', () => {
  const result = run(['remove', 'nonexistent', '--yes']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile 'nonexistent' not found/);
});

test('cc-use remove --yes deletes profile config', () => {
  setupProfile('toremove');
  const providersDir = join(ccUseDir, 'providers');
  assert.ok(existsSync(join(providersDir, 'toremove.json')));
  const result = run(['remove', 'toremove', '--yes']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(providersDir, 'toremove.json')));
});

test('cc-use remove keeps session by default', () => {
  setupProfile('keep-sess');
  const sessDir = join(ccUseDir, 'sessions', 'keep-sess');
  mkdirSync(sessDir, { recursive: true });
  writeFileSync(join(sessDir, 'test.txt'), 'data');
  const result = run(['remove', 'keep-sess', '--yes']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(sessDir));
});

test('cc-use remove --delete-session removes session dir', () => {
  setupProfile('del-sess');
  const sessDir = join(ccUseDir, 'sessions', 'del-sess');
  mkdirSync(sessDir, { recursive: true });
  writeFileSync(join(sessDir, 'test.txt'), 'data');
  const result = run(['remove', 'del-sess', '--yes', '--delete-session']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(sessDir));
});

test('cc-use remove unsets configured default when removing default profile', () => {
  setupProfile('def-remove');
  // Set it as default via config.json
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ default: 'def-remove' }));
  const result = run(['remove', 'def-remove', '--yes']);
  assert.equal(result.status, 0, result.stderr);
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
  assert.equal(cfg.default, undefined);
});

test('cc-use remove warns when CC_USE_DEFAULT points at removed profile', () => {
  setupProfile('env-def');
  const result = run(['remove', 'env-def', '--yes'], { CC_USE_DEFAULT: 'env-def' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /CC_USE_DEFAULT still points to 'env-def'/);
});

test('cc-use remove does not affect non-matching default', () => {
  setupProfile('other');
  setupProfile('keep-default');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ default: 'keep-default' }));
  const result = run(['remove', 'other', '--yes']);
  assert.equal(result.status, 0, result.stderr);
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
  assert.equal(cfg.default, 'keep-default');
});

test('cc-use remove requires --yes in non-TTY', () => {
  setupProfile('need-yes');
  const result = run(['remove', 'need-yes']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non-interactive mode requires --yes/);
});

test('cc-use remove unknown flag errors', () => {
  const result = run(['remove', 'foo', '--bogus']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use remove: unknown flag '--bogus'/);
});

test('--help stdout includes remove subcommand usage', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cc-use remove <profile>/);
});

test('--help stdout includes auto and status usage', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cc-use auto/);
  assert.match(result.stdout, /cc-use status/);
});

// --- no-default startup recovery ---

test('cc-use no-arg with no profiles in non-TTY errors', () => {
  // Ensure clean state: no config.json, no profiles
  const configPath = join(ccUseDir, 'config.json');
  if (existsSync(configPath)) rmSync(configPath);
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no default profile set/);
});

test('cc-use default launch reports broken configured default clearly', () => {
  const dir = isolatedCcUseDir('cc-use-cli-broken-default-');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ default: 'missing-profile' }));

  const result = run([], { CC_USE_DIR: dir });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /default profile 'missing-profile' not found/);
});

test('cc-use default launch reports broken CC_USE_DEFAULT clearly', () => {
  const dir = isolatedCcUseDir('cc-use-cli-broken-env-default-');
  mkdirSync(dir, { recursive: true });

  const result = run([], { CC_USE_DIR: dir, CC_USE_DEFAULT: 'missing-env-profile' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CC_USE_DEFAULT points to 'missing-env-profile'/);
});

test('cc-use default launch rejects unfinished default profile in non-TTY', () => {
  const dir = isolatedCcUseDir('cc-use-cli-placeholder-default-');
  const providersDir = join(dir, 'providers');
  mkdirSync(providersDir, { recursive: true });
  writeFileSync(
    join(providersDir, 'unfinished.json'),
    JSON.stringify({
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      ANTHROPIC_AUTH_TOKEN: '<API_KEY>',
    }),
  );
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ default: 'unfinished' }));

  const result = run([], { CC_USE_DIR: dir });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /default profile 'unfinished' has unfilled placeholders/);
});


// --- v0.5 with-first semantics ---

test('cc-use default profile uses native ~/.claude', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
});

test('cc-use -p passes args through with default profile', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
});

test('cc-use -- passes args through with default profile', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['--', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.ok(!result.stdout.includes('ARG:--'), '`--` separator should be stripped, not passed to claude');
  assert.ok(result.stdout.includes('ARG:-p'));
  assert.ok(result.stdout.includes('ARG:review this'));
});

test('cc-use <profile> passes args through', { skip: posixOnly }, () => {
  setupProfile();
  const result = run(['deepseek', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
});

test('cc-use with default profile uses native ~/.claude', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['with']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
});

test('cc-use with -p passes args through with default profile', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['with', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
});

test('cc-use with -- passes args through with default profile', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['with', '--', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.ok(!result.stdout.includes('ARG:--'), '`--` separator should be stripped, not passed to claude');
  assert.ok(result.stdout.includes('ARG:-p'));
  assert.ok(result.stdout.includes('ARG:review this'));
});

test('cc-use isolate default profile uses session dir', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['isolate']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${sessionDir}\n`));
});

test('cc-use isolate -p passes args through with default profile', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['isolate', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${sessionDir}\n`));
});

test('cc-use isolate -- passes args through with default profile', { skip: posixOnly }, () => {
  setupProfile();
  setDefault('deepseek');
  const result = run(['isolate', '--', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${sessionDir}\n`));
  assert.ok(!result.stdout.includes('ARG:--'), '`--` separator should be stripped, not passed to claude');
  assert.ok(result.stdout.includes('ARG:-p'));
  assert.ok(result.stdout.includes('ARG:review this'));
});

test('cc-use isolate auto selects usable profile in isolated mode', { skip: posixOnly }, () => {
  setupProfile('iso-auto');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'iso-auto',
      auto: {
        fallbackOrder: [],
        profiles: {
          'iso-auto': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['isolate', 'auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${join(ccUseDir, 'sessions', 'iso-auto')}\n`));
  assert.match(result.stderr, /selected 'iso-auto' \(manual_available\)/);
});


test('cc-use auto -- strips separator and passes args through', { skip: posixOnly }, () => {
  setupProfile('auto-dash');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'auto-dash',
      auto: {
        fallbackOrder: [],
        profiles: {
          'auto-dash': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['auto', '--', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.ok(!result.stdout.includes('ARG:--'), '`--` separator should be stripped, not passed to claude');
  assert.ok(result.stdout.includes('ARG:-p'));
  assert.ok(result.stdout.includes('ARG:review this'));
});

test('cc-use with auto -- strips separator and passes args through', { skip: posixOnly }, () => {
  setupProfile('auto-with-dash');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'auto-with-dash',
      auto: {
        fallbackOrder: [],
        profiles: {
          'auto-with-dash': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['with', 'auto', '--', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${nativeClaudeDir}\n`));
  assert.ok(!result.stdout.includes('ARG:--'), '`--` separator should be stripped, not passed to claude');
  assert.ok(result.stdout.includes('ARG:-p'));
  assert.ok(result.stdout.includes('ARG:review this'));
});

test('cc-use isolate auto -- strips separator and passes args through', { skip: posixOnly }, () => {
  setupProfile('auto-iso-dash');
  const configPath = join(ccUseDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      default: 'auto-iso-dash',
      auto: {
        fallbackOrder: [],
        profiles: {
          'auto-iso-dash': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['isolate', 'auto', '--', '-p', 'review this']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`CLAUDE_CONFIG_DIR=${join(ccUseDir, 'sessions', 'auto-iso-dash')}\n`));
  assert.ok(!result.stdout.includes('ARG:--'), '`--` separator should be stripped, not passed to claude');
  assert.ok(result.stdout.includes('ARG:-p'));
  assert.ok(result.stdout.includes('ARG:review this'));
});

// v0.6 launch-time auto-sync tests

test('cc-use isolate <profile> auto-syncs safe native context', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-isolate-sync');
  const nativeDir = join(home, '.claude');
  const projectDir = join(nativeDir, 'projects', 'my-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'session.jsonl'), '{"type":"user"}\n');
  writeFileSync(join(nativeDir, 'settings.json'), JSON.stringify({ theme: 'dark', effortLevel: 'high' }));
  mkdirSync(join(nativeDir, 'agents'), { recursive: true });
  writeFileSync(join(nativeDir, 'agents', 'agent.json'), '{"name":"test"}');

  setupProfile('iso-sync');
  const result = run(['isolate', 'iso-sync'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);

  const targetDir = join(ccUseDir, 'sessions', 'iso-sync');
  assert.equal(existsSync(join(targetDir, 'projects', 'my-project', 'session.jsonl')), true);
  assert.equal(existsSync(join(targetDir, 'settings.json')), true);
  assert.equal(existsSync(join(targetDir, 'agents', 'agent.json')), true);

  rmSync(targetDir, { recursive: true, force: true });
});

test('cc-use isolate auto-sync filters settings-safe fields', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-isolate-settings');
  const nativeDir = join(home, '.claude');
  mkdirSync(nativeDir, { recursive: true });
  writeFileSync(
    join(nativeDir, 'settings.json'),
    JSON.stringify({ theme: 'dark', env: { SECRET: 'x' }, hooks: { pre: 'cmd' } }),
  );

  setupProfile('iso-settings');
  const result = run(['isolate', 'iso-settings'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);

  const targetDir = join(ccUseDir, 'sessions', 'iso-settings');
  const settings = JSON.parse(readFileSync(join(targetDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(settings.theme, 'dark');
  assert.equal('env' in settings, false);
  assert.equal('hooks' in settings, false);

  rmSync(targetDir, { recursive: true, force: true });
});

test('cc-use isolate auto-sync skips existing targets without overwriting', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-isolate-skip');
  const nativeDir = join(home, '.claude');
  const projectDir = join(nativeDir, 'projects', 'my-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'session.jsonl'), '{"type":"user","content":"native"}\n');

  setupProfile('iso-skip');

  // Pre-create target with different content
  const targetDir = join(ccUseDir, 'sessions', 'iso-skip');
  const targetProjectDir = join(targetDir, 'projects', 'my-project');
  mkdirSync(targetProjectDir, { recursive: true });
  writeFileSync(join(targetProjectDir, 'session.jsonl'), '{"type":"user","content":"existing"}\n');

  const result = run(['isolate', 'iso-skip'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);

  const content = readFileSync(join(targetProjectDir, 'session.jsonl'), 'utf8');
  assert.match(content, /existing/);

  rmSync(targetDir, { recursive: true, force: true });
});

test('cc-use isolate auto-sync does not overwrite sanitized history', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-isolate-sanitize');
  const nativeDir = join(home, '.claude');
  const projectDir = join(nativeDir, 'projects', 'my-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'session.jsonl'),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'secret' }],
      },
    }) + '\n',
  );

  setupProfile('iso-sanitize');

  // Manually sanitize import first
  const result1 = run(
    ['import-context', 'iso-sanitize', '--include', 'projects', '--sanitize-history', '--force'],
    { HOME: home },
  );
  assert.equal(result1.status, 0, result1.stderr);

  const targetDir = join(ccUseDir, 'sessions', 'iso-sanitize');
  const targetProjectDir = join(targetDir, 'projects', 'my-project');
  const sanitized = readFileSync(join(targetProjectDir, 'session.jsonl'), 'utf8');
  assert.doesNotMatch(sanitized, /"type":"thinking"/);

  // Now run isolate — auto-sync should NOT overwrite with raw
  const result2 = run(['isolate', 'iso-sanitize'], { HOME: home });
  assert.equal(result2.status, 0, result2.stderr);

  const afterIsolate = readFileSync(join(targetProjectDir, 'session.jsonl'), 'utf8');
  assert.doesNotMatch(afterIsolate, /"type":"thinking"/);

  rmSync(targetDir, { recursive: true, force: true });
});

test('cc-use isolate auto-syncs default profile', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-isolate-default');
  const nativeDir = join(home, '.claude');
  mkdirSync(nativeDir, { recursive: true });
  writeFileSync(join(nativeDir, 'settings.json'), JSON.stringify({ theme: 'light' }));

  setupProfile('iso-default');
  setDefault('iso-default');

  const result = run(['isolate'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);

  const targetDir = join(ccUseDir, 'sessions', 'iso-default');
  const settings = JSON.parse(readFileSync(join(targetDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(settings.theme, 'light');

  rmSync(targetDir, { recursive: true, force: true });
});

test('cc-use with does not auto-sync to session dir', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-with-no-sync');
  const nativeDir = join(home, '.claude');
  mkdirSync(nativeDir, { recursive: true });
  writeFileSync(join(nativeDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));

  setupProfile('with-no-sync');
  const result = run(['with', 'with-no-sync'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);

  const targetDir = join(ccUseDir, 'sessions', 'with-no-sync');
  assert.equal(existsSync(join(targetDir, 'settings.json')), false);
});

test('cc-use isolate auto syncs selected profile', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-isolate-auto-sync');
  const nativeDir = join(home, '.claude');
  mkdirSync(nativeDir, { recursive: true });
  writeFileSync(join(nativeDir, 'settings.json'), JSON.stringify({ theme: 'auto' }));

  setupProfile('iso-auto-sync');
  writeFileSync(
    join(ccUseDir, 'config.json'),
    JSON.stringify({
      default: 'iso-auto-sync',
      auto: {
        fallbackOrder: [],
        profiles: {
          'iso-auto-sync': {
            mode: 'token_plan',
            check: { kind: 'manual_availability', available: true },
          },
        },
      },
    }),
  );

  const result = run(['isolate', 'auto'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);

  const targetDir = join(ccUseDir, 'sessions', 'iso-auto-sync');
  const settings = JSON.parse(readFileSync(join(targetDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(settings.theme, 'auto');

  rmSync(targetDir, { recursive: true, force: true });
});

test('cc-use isolate auto-sync does not copy risky categories', { skip: posixOnly }, () => {
  const home = join(tmp, 'home-isolate-no-risky');
  const nativeDir = join(home, '.claude');
  mkdirSync(join(nativeDir, 'mcp'), { recursive: true });
  writeFileSync(join(nativeDir, 'mcp', 'config.json'), '{}');
  mkdirSync(join(nativeDir, 'hooks'), { recursive: true });
  writeFileSync(join(nativeDir, 'hooks.json'), '{}');
  mkdirSync(join(nativeDir, 'plugins'), { recursive: true });
  writeFileSync(join(nativeDir, 'plugins', 'installed.json'), '{}');

  setupProfile('iso-no-risky');
  const result = run(['isolate', 'iso-no-risky'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);

  const targetDir = join(ccUseDir, 'sessions', 'iso-no-risky');
  assert.equal(existsSync(join(targetDir, 'mcp')), false);
  assert.equal(existsSync(join(targetDir, 'hooks')), false);
  assert.equal(existsSync(join(targetDir, 'hooks.json')), false);
  assert.equal(existsSync(join(targetDir, 'plugins')), false);

  rmSync(targetDir, { recursive: true, force: true });
});
