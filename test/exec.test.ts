import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChildEnv, spawnClaude } from '../src/exec.js';
import type { Profile } from '../src/profile.js';

const profile: Profile = {
  name: 'deepseek',
  source: '/tmp/deepseek.json',
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'sk-test',
    ANTHROPIC_MODEL: 'deepseek-v4-pro',
  },
};

test('buildChildEnv injects CLAUDE_CONFIG_DIR pointing at the session dir', () => {
  const env = buildChildEnv(profile, '/sessions/deepseek', { PATH: '/usr/bin' });
  assert.equal(env.CLAUDE_CONFIG_DIR, '/sessions/deepseek');
});

test('buildChildEnv merges profile env over the base env', () => {
  const base = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://leak.example.com' };
  const env = buildChildEnv(profile, '/sessions/deepseek', base);
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-test');
  assert.equal(env.PATH, '/usr/bin');
});

test('buildChildEnv does not mutate the base env or process.env', () => {
  const base = { PATH: '/usr/bin' };
  const baseSnapshot = { ...base };
  const procSnapshot = { ...process.env };

  buildChildEnv(profile, '/sessions/deepseek', base);
  buildChildEnv(profile, '/sessions/deepseek');

  assert.deepEqual(base, baseSnapshot);
  assert.equal(process.env.CLAUDE_CONFIG_DIR, procSnapshot.CLAUDE_CONFIG_DIR);
  assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, procSnapshot.ANTHROPIC_AUTH_TOKEN);
  assert.equal(process.env.ANTHROPIC_BASE_URL, procSnapshot.ANTHROPIC_BASE_URL);
});

test('buildChildEnv CLAUDE_CONFIG_DIR overrides any value in the base env', () => {
  const base = { CLAUDE_CONFIG_DIR: '/should/be/replaced' };
  const env = buildChildEnv(profile, '/sessions/deepseek', base);
  assert.equal(env.CLAUDE_CONFIG_DIR, '/sessions/deepseek');
});

test('spawnClaude returns the child exit code and creates CLAUDE_CONFIG_DIR', async (t) => {
  if (process.platform === 'win32') {
    t.skip('fake executable script is POSIX-only');
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'cc-use-exec-test-'));
  const binDir = join(tmp, 'bin');
  const sessionDir = join(tmp, 'session');
  const realPath = process.env.PATH;
  try {
    mkdirSync(binDir, { recursive: true });
    const fakeClaude = join(binDir, 'claude');
    writeFileSync(fakeClaude, '#!/usr/bin/env node\nprocess.exit(Number(process.argv[2] || 0));\n');
    chmodSync(fakeClaude, 0o755);
    process.env.PATH = `${binDir}:${realPath ?? ''}`;

    const code = await spawnClaude(profile, ['7'], { claudeConfigDir: sessionDir });
    assert.equal(code, 7);
    assert.equal(existsSync(sessionDir), true);
  } finally {
    process.env.PATH = realPath;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('spawnClaude returns 127 when claude is not on PATH', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows shell lookup differs from direct POSIX ENOENT behavior');
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'cc-use-exec-missing-test-'));
  const realPath = process.env.PATH;
  try {
    process.env.PATH = tmp;
    const code = await spawnClaude(profile, [], { claudeConfigDir: join(tmp, 'session') });
    assert.equal(code, 127);
  } finally {
    process.env.PATH = realPath;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('spawnClaude maps signal exits to shell-style exit codes', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX signals are not portable to Windows shell execution');
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'cc-use-exec-signal-test-'));
  const binDir = join(tmp, 'bin');
  const realPath = process.env.PATH;
  try {
    mkdirSync(binDir, { recursive: true });
    const fakeClaude = join(binDir, 'claude');
    writeFileSync(
      fakeClaude,
      '#!/usr/bin/env node\nprocess.kill(process.pid, "SIGTERM");\nsetTimeout(() => {}, 1000);\n',
    );
    chmodSync(fakeClaude, 0o755);
    process.env.PATH = `${binDir}:${realPath ?? ''}`;

    const code = await spawnClaude(profile, [], { claudeConfigDir: join(tmp, 'session') });
    assert.equal(code, 143);
  } finally {
    process.env.PATH = realPath;
    rmSync(tmp, { recursive: true, force: true });
  }
});
