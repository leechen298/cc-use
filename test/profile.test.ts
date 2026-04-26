import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set CC_USE_DIR before importing modules so paths.ts picks it up.
const tmp = mkdtempSync(join(tmpdir(), 'cc-use-test-'));
process.env.CC_USE_DIR = tmp;

const providersDir = join(tmp, 'providers');
const fs = await import('node:fs');
fs.mkdirSync(providersDir, { recursive: true });

const profileMod = await import('../src/profile.js');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

function writeProfile(name: string, body: unknown): void {
  writeFileSync(join(providersDir, `${name}.json`), JSON.stringify(body, null, 2));
}

test('listProfiles is empty when nothing configured', () => {
  const list = profileMod.listProfiles();
  assert.equal(list.length, 0);
});

test('reserved subcommand names are blocked', () => {
  assert.equal(profileMod.isReserved('init'), true);
  assert.equal(profileMod.isReserved('default'), true);
  assert.equal(profileMod.isReserved('deepseek'), false);
});

test('loadProfile rejects missing required fields', () => {
  writeProfile('bad1', { ANTHROPIC_BASE_URL: 'https://x' });
  assert.throws(() => profileMod.loadProfile('bad1'), /ANTHROPIC_AUTH_TOKEN/);
});

test('loadProfile rejects invalid env names', () => {
  writeProfile('bad2', {
    ANTHROPIC_BASE_URL: 'https://x',
    ANTHROPIC_AUTH_TOKEN: 'k',
    'bad-name': 'v',
  });
  assert.throws(() => profileMod.loadProfile('bad2'), /invalid env name/);
});

test('loadProfile coerces bool/number values', () => {
  writeProfile('good', {
    ANTHROPIC_BASE_URL: 'https://x',
    ANTHROPIC_AUTH_TOKEN: 'k',
    A_BOOL: true,
    A_NUM: 42,
  });
  const p = profileMod.loadProfile('good');
  assert.equal(p.env.A_BOOL, '1');
  assert.equal(p.env.A_NUM, '42');
});

test('placeholder detection', () => {
  assert.equal(profileMod.looksLikePlaceholder('<KEY>'), true);
  assert.equal(profileMod.looksLikePlaceholder(''), true);
  assert.equal(profileMod.looksLikePlaceholder('YOUR_API_KEY'), true);
  assert.equal(profileMod.looksLikePlaceholder('sk-real-key-here'), false);
});

test('findPlaceholders flags unfilled required fields', () => {
  assert.deepEqual(
    profileMod.findPlaceholders({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: '<DEEPSEEK_API_KEY>',
    }),
    ['ANTHROPIC_AUTH_TOKEN'],
  );
  assert.deepEqual(
    profileMod.findPlaceholders({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-real',
    }),
    [],
  );
});
