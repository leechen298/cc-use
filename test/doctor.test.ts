import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'cc-use-doctor-test-'));
process.env.CC_USE_DIR = tmp;
const providersDir = join(tmp, 'providers');
mkdirSync(providersDir, { recursive: true });

writeFileSync(
  join(providersDir, 'deepseek.json'),
  JSON.stringify({
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'sk-real-token-for-doctor-test',
  }),
);

const doctorMod = await import('../src/doctor.js');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

test('runDoctor with probe=false does not call fetch', async () => {
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (..._args: unknown[]) => {
    fetchCalls++;
    throw new Error('fetch should not be called when probe is false');
  }) as typeof fetch;

  try {
    const code = await doctorMod.runDoctor({ profile: 'deepseek', probe: false });
    assert.equal(code, 0);
    assert.equal(fetchCalls, 0, 'fetch was called despite --no-probe');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('runDoctor with probe=true does call fetch (once)', async () => {
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (..._args: unknown[]) => {
    fetchCalls++;
    return new Response(
      JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'ok' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const code = await doctorMod.runDoctor({ profile: 'deepseek', probe: true });
    assert.equal(code, 0);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
