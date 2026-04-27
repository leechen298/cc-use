import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChildEnv } from '../src/exec.js';
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
