import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'cc-use-auto-test-'));
process.env.CC_USE_DIR = tmp;

const providersDir = join(tmp, 'providers');
const configPath = join(tmp, 'config.json');
const statusPath = join(tmp, 'status.json');

const autoMod = await import('../src/auto.js');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

function resetState(): void {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(providersDir, { recursive: true });
}

function writeProfile(name: string, env?: Record<string, unknown>): void {
  mkdirSync(providersDir, { recursive: true });
  writeFileSync(
    join(providersDir, `${name}.json`),
    JSON.stringify(
      env ?? {
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-test-token',
      },
      null,
      2,
    ),
  );
}

function writeConfig(body: unknown): void {
  mkdirSync(tmp, { recursive: true });
  writeFileSync(configPath, JSON.stringify(body, null, 2));
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('checkUsability returns unknown when auto profile config is absent', async () => {
  resetState();
  const result = await autoMod.checkUsability('missing-config', {
    cacheTtlSeconds: 60,
    fallbackOrder: [],
    profiles: {},
  });
  assert.equal(result.usable, false);
  assert.equal(result.reason, 'unknown');
});

test('checkUsability reports missing and invalid profiles as check failures', async () => {
  resetState();
  const missing = await autoMod.checkUsability('missing-profile', {
    cacheTtlSeconds: 60,
    fallbackOrder: ['missing-profile'],
    profiles: { 'missing-profile': { check: { kind: 'manual_availability', available: true } } },
  });
  assert.equal(missing.reason, 'check_failed');
  assert.equal(missing.details?.errorType, 'profile_not_found');

  writeFileSync(join(providersDir, 'broken.json'), '{bad json');
  const broken = await autoMod.checkUsability('broken', {
    cacheTtlSeconds: 60,
    fallbackOrder: ['broken'],
    profiles: { broken: { check: { kind: 'manual_availability', available: true } } },
  });
  assert.equal(broken.reason, 'check_failed');
  assert.equal(broken.details?.errorType, 'profile_load_failed');
});

test('checkUsability reports unfinished profiles and missing checks', async () => {
  resetState();
  writeProfile('unfinished', {
    ANTHROPIC_BASE_URL: 'https://api.example.com',
    ANTHROPIC_AUTH_TOKEN: '<API_KEY>',
  });
  const unfinished = await autoMod.checkUsability('unfinished', {
    cacheTtlSeconds: 60,
    fallbackOrder: ['unfinished'],
    profiles: { unfinished: { check: { kind: 'manual_availability', available: true } } },
  });
  assert.equal(unfinished.reason, 'check_failed');
  assert.equal(unfinished.details?.errorType, 'profile_unfinished');

  writeProfile('unknown-check');
  const unknown = await autoMod.checkUsability('unknown-check', {
    cacheTtlSeconds: 60,
    fallbackOrder: ['unknown-check'],
    profiles: { 'unknown-check': {} },
  });
  assert.equal(unknown.reason, 'unknown');
});

test('checkUsability maps api balance adapter failures into check_failed', async () => {
  resetState();
  writeProfile('api-profile');
  const result = await autoMod.checkUsability('api-profile', {
    cacheTtlSeconds: 60,
    fallbackOrder: ['api-profile'],
    profiles: {
      'api-profile': {
        minBalance: 10,
        check: { kind: 'api', adapter: 'reserved-adapter' },
      },
    },
  });
  assert.equal(result.usable, false);
  assert.equal(result.reason, 'check_failed');
  assert.equal(result.details?.adapter, 'reserved-adapter');
  assert.equal(result.details?.errorType, 'balance_check_failed');
});

test('checkUsability maps probe outcomes into auto usability reasons', async () => {
  resetState();
  writeProfile('probe-profile');
  const auto = {
    cacheTtlSeconds: 60,
    fallbackOrder: ['probe-profile'],
    profiles: { 'probe-profile': { check: { kind: 'probe' as const } } },
  };

  const ok = await withFetch(
    (async () =>
      new Response(JSON.stringify({ type: 'message', content: [] }), {
        status: 200,
        statusText: 'OK',
      })) as typeof fetch,
    () => autoMod.checkUsability('probe-profile', auto),
  );
  assert.equal(ok.usable, true);
  assert.equal(ok.reason, 'probe_ok');
  assert.equal(ok.details?.httpStatus, 200);

  const rejected = await withFetch(
    (async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'auth_error', message: 'bad key' } }), {
        status: 401,
        statusText: 'Unauthorized',
      })) as typeof fetch,
    () => autoMod.checkUsability('probe-profile', auto),
  );
  assert.equal(rejected.usable, false);
  assert.equal(rejected.reason, 'probe_failed');
  assert.equal(rejected.details?.errorType, 'auth_error');

  const failed = await withFetch(
    (async () => {
      throw new Error('network down');
    }) as typeof fetch,
    () => autoMod.checkUsability('probe-profile', auto),
  );
  assert.equal(failed.usable, false);
  assert.equal(failed.reason, 'check_failed');
  assert.equal(failed.details?.errorType, 'network_error');
});

test('selectAutoProfile handles empty candidates and fresh cache hits', async () => {
  resetState();
  writeConfig({});
  assert.equal(await autoMod.selectAutoProfile(), 1);

  resetState();
  writeProfile('cached');
  writeConfig({
    auto: {
      cacheTtlSeconds: 60,
      fallbackOrder: ['cached'],
      profiles: {
        cached: { check: { kind: 'manual_availability', available: false } },
      },
    },
  });
  writeFileSync(
    statusPath,
    JSON.stringify({
      profiles: {
        cached: {
          profileName: 'cached',
          usable: true,
          reason: 'manual_available',
          checkedAt: new Date().toISOString(),
        },
      },
    }),
  );
  assert.equal(await autoMod.selectAutoProfile(), 'cached');
});
