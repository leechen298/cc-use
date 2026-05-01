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
writeFileSync(fakeClaude, '#!/bin/sh\necho "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"\n');
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

test('cc-use with missing profile name errors', () => {
  const result = run(['with']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use with: profile name required/);
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

test('cc-use <profile> (isolated) sets CLAUDE_CONFIG_DIR to session dir', { skip: posixOnly }, () => {
  setupProfile();
  const result = run(['deepseek']);
  assert.equal(result.status, 0, result.stderr);
  // CC_USE_DIR=tmp/cc-use → sessionDirFor('deepseek') = tmp/cc-use/sessions/deepseek
  assert.ok(
    result.stdout.includes(`CLAUDE_CONFIG_DIR=${sessionDir}\n`),
    `expected CLAUDE_CONFIG_DIR=${sessionDir}, got: ${result.stdout}`,
  );
});

test('with is a reserved subcommand name', () => {
  assert.equal(isReserved('with'), true);
});

test('isolate is a reserved subcommand name', () => {
  assert.equal(isReserved('isolate'), true);
});

test('help text includes cc-use with <profile>', () => {
  assert.match(USAGE, /cc-use with <profile>/);
});

test('cc-use isolate with missing profile name errors', () => {
  const result = run(['isolate']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cc-use isolate: profile name required/);
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
  assert.match(result.stdout, /cc-use isolate <profile>/);
});

test('--help stdout includes with subcommand usage', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cc-use with <profile>/);
});

// --- remove command ---

test('remove is a reserved subcommand name', () => {
  assert.equal(isReserved('remove'), true);
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

// --- no-default startup recovery ---

test('cc-use no-arg with no profiles in non-TTY errors', () => {
  // Ensure clean state: no config.json, no profiles
  const configPath = join(ccUseDir, 'config.json');
  if (existsSync(configPath)) rmSync(configPath);
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no default profile set/);
});
