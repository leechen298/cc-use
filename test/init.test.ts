import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'cc-use-init-test-'));
process.env.CC_USE_DIR = tmp;
mkdirSync(join(tmp, 'providers'), { recursive: true });

const initMod = await import('../src/init.js');
const pathsMod = await import('../src/paths.js');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

test('runInit writes provider config with mode 0600 (POSIX only)', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX file modes not meaningful on Windows');
    return;
  }

  const code = await initMod.runInit({
    template: 'deepseek',
    name: 'deepseek-test',
    token: 'sk-test-key-1234',
    nonInteractive: true,
    skipProbe: true,
  });
  assert.equal(code, 0);

  const path = pathsMod.profilePath('deepseek-test');
  const stat = statSync(path);
  const mode = stat.mode & 0o777;
  assert.equal(
    mode,
    0o600,
    `expected 0600, got 0${mode.toString(8)} — README promises chmod 600`,
  );
});

test('runInit non-interactive mode requires a token', async () => {
  const name = 'missing-token-test';

  const code = await initMod.runInit({
    template: 'deepseek',
    name,
    nonInteractive: true,
    skipProbe: true,
  });

  assert.equal(code, 1);
  assert.equal(existsSync(pathsMod.profilePath(name)), false);
});

test('runInit non-interactive mode rejects templates without a concrete base URL', async () => {
  const name = 'custom-no-base-test';

  const code = await initMod.runInit({
    template: 'custom',
    name,
    token: 'sk-test-key-1234',
    nonInteractive: true,
    skipProbe: true,
  });

  assert.equal(code, 1);
  assert.equal(existsSync(pathsMod.profilePath(name)), false);
});

test('runInit refuses to overwrite an existing profile without force', async () => {
  const name = 'overwrite-guard-test';
  const first = await initMod.runInit({
    template: 'deepseek',
    name,
    token: 'sk-test-key-1234',
    nonInteractive: true,
    skipProbe: true,
  });
  assert.equal(first, 0);

  const second = await initMod.runInit({
    template: 'deepseek',
    name,
    token: 'sk-other-key-5678',
    nonInteractive: true,
    skipProbe: true,
  });

  assert.equal(second, 1);
  const stored = JSON.parse(readFileSync(pathsMod.profilePath(name), 'utf8'));
  assert.equal(stored.ANTHROPIC_AUTH_TOKEN, 'sk-test-key-1234');
});

test('runInit --set-default writes config and prints default launch hint', async () => {
  const name = 'default-init-test';

  const code = await initMod.runInit({
    template: 'deepseek',
    name,
    token: 'sk-test-key-1234',
    nonInteractive: true,
    setDefault: true,
    skipProbe: true,
  });

  assert.equal(code, 0);
  const config = JSON.parse(readFileSync(join(tmp, 'config.json'), 'utf8'));
  assert.equal(config.default, name);
});

test('runInit runs doctor when probe is enabled', async (t) => {
  const name = 'probe-init-test';
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ type: 'message', content: [] }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const code = await initMod.runInit({
    template: 'deepseek',
    name,
    token: 'sk-test-key-1234',
    nonInteractive: true,
  });

  assert.equal(code, 0);
  assert.equal(fetchCalls, 1);
});
