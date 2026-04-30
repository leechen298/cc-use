import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { USAGE } from '../src/help.js';
import { isReserved } from '../src/profile.js';

const tmp = mkdtempSync(join(tmpdir(), 'cc-use-cli-test-'));
const ccUseDir = join(tmp, 'cc-use');
const cliPath = join(process.cwd(), 'dist/cli.js');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

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
    env: { ...process.env, CC_USE_DIR: ccUseDir, ...envOverrides },
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

test('cc-use with valid profile spawns claude (ENOENT=127 when claude not installed)', () => {
  setupProfile();
  const result = run(['with', 'deepseek', '--version']);
  // 127 = claude not found in PATH (CI), 0 = claude found and launched OK
  if (result.status !== 0) {
    assert.equal(result.status, 127, result.stderr);
    assert.match(result.stderr, /claude.*not found/);
  }
});

test('cc-use deepseek (isolated) spawns claude with session dir', () => {
  setupProfile();
  const result = run(['deepseek', '--version']);
  if (result.status !== 0) {
    assert.equal(result.status, 127, result.stderr);
    assert.match(result.stderr, /claude.*not found/);
  }
});

test('with is a reserved subcommand name', () => {
  assert.equal(isReserved('with'), true);
});

test('help text includes cc-use with <profile>', () => {
  assert.match(USAGE, /cc-use with <profile>/);
});

test('--help stdout includes with subcommand usage', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cc-use with <profile>/);
});
