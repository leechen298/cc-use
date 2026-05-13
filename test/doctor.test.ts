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

writeFileSync(
  join(providersDir, 'placeholder.json'),
  JSON.stringify({
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: '<API_KEY>',
  }),
);

const doctorMod = await import('../src/doctor.js');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

function profile() {
  return {
    name: 'deepseek',
    source: join(providersDir, 'deepseek.json'),
    env: {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-test',
      ANTHROPIC_MODEL: 'test-model',
    },
  };
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

test('probeMessagesApi treats non-JSON gateway errors as check failures', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response('<html>bad gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;

  try {
    const result = await doctorMod.probeMessagesApi({
      name: 'deepseek',
      source: join(providersDir, 'deepseek.json'),
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-test',
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorType, 'invalid_json');
    assert.equal(result.httpStatus, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('probeMessagesApi reports network, read, empty, and invalid-shape failures', async () => {
  const network = await withFetch(
    (async () => {
      throw new Error('socket closed');
    }) as typeof fetch,
    () => doctorMod.probeMessagesApi(profile()),
  );
  assert.equal(network.status, 'failed');
  assert.equal(network.errorType, 'network_error');

  const readError = await withFetch(
    (async () =>
      ({
        status: 200,
        statusText: 'OK',
        text: async () => {
          throw new Error('cannot read body');
        },
      }) as Response) as typeof fetch,
    () => doctorMod.probeMessagesApi(profile()),
  );
  assert.equal(readError.status, 'failed');
  assert.equal(readError.errorType, 'read_error');
  assert.equal(readError.httpStatus, 200);

  const empty = await withFetch(
    (async () => new Response('', { status: 200, statusText: 'OK' })) as typeof fetch,
    () => doctorMod.probeMessagesApi(profile()),
  );
  assert.equal(empty.status, 'failed');
  assert.equal(empty.errorType, 'invalid_response');

  const invalidShape = await withFetch(
    (async () => new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' })) as typeof fetch,
    () => doctorMod.probeMessagesApi(profile()),
  );
  assert.equal(invalidShape.status, 'failed');
  assert.equal(invalidShape.errorType, 'invalid_response');
});

test('probeMessagesApi describes non-Anthropic rejected responses with http fallback', async () => {
  const result = await withFetch(
    (async () => new Response(JSON.stringify({ error: 'bad' }), { status: 429, statusText: 'Too Many Requests' })) as typeof fetch,
    () => doctorMod.probeMessagesApi(profile()),
  );
  assert.equal(result.status, 'rejected');
  assert.equal(result.errorType, 'http_429');
  assert.equal(result.errorMessage, 'response body is not an Anthropic Messages response');
});

test('runDoctor handles placeholder, auth, endpoint, error, unknown, and load failures', async () => {
  assert.equal(await doctorMod.runDoctor({ profile: 'missing', probe: false }), 1);
  assert.equal(await doctorMod.runDoctor({ profile: 'placeholder', probe: true }), 1);

  const auth = await withFetch(
    (async () =>
      new Response(
        JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }),
        { status: 401, statusText: 'Unauthorized' },
      )) as typeof fetch,
    () => doctorMod.runDoctor({ profile: 'deepseek', probe: true }),
  );
  assert.equal(auth, 1);

  const endpoint = await withFetch(
    (async () =>
      new Response(
        JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'missing' } }),
        { status: 404, statusText: 'Not Found' },
      )) as typeof fetch,
    () => doctorMod.runDoctor({ profile: 'deepseek', probe: true }),
  );
  assert.equal(endpoint, 1);

  const anthropicError = await withFetch(
    (async () =>
      new Response(
        JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
        { status: 429, statusText: 'Too Many Requests' },
      )) as typeof fetch,
    () => doctorMod.runDoctor({ profile: 'deepseek', probe: true }),
  );
  assert.equal(anthropicError, 1);

  const unknown = await withFetch(
    (async () => new Response(JSON.stringify({ error: 'plain gateway error' }), { status: 502, statusText: 'Bad Gateway' })) as typeof fetch,
    () => doctorMod.runDoctor({ profile: 'deepseek', probe: true }),
  );
  assert.equal(unknown, 1);

  const failed = await withFetch(
    (async () => {
      throw new Error('offline');
    }) as typeof fetch,
    () => doctorMod.runDoctor({ profile: 'deepseek', probe: true }),
  );
  assert.equal(failed, 1);
});

test('runDoctorAll summarizes mixed profile outcomes', async () => {
  writeFileSync(
    join(providersDir, 'bad.json'),
    JSON.stringify({
      ANTHROPIC_BASE_URL: 'https://api.example.com',
    }),
  );
  const code = await doctorMod.runDoctorAll({ probe: false });
  assert.equal(code, 1);
});
