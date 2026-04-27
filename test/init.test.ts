import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
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
